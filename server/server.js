const net = require('net');
const dgram = require('dgram');

// Constants
const CONTROL_PORT = process.env.CONTROL_PORT || 5000;
const SECRET_KEY = process.env.SECRET_KEY || 'changeme';

// Protocol Types
const TYPE_AUTH = 0;
const TYPE_TCP_OPEN = 1;
const TYPE_TCP_DATA = 2;
const TYPE_TCP_CLOSE = 3;
const TYPE_UDP_OPEN = 4; // Not strictly used for opening, but for notifying new sessions
const TYPE_UDP_DATA = 5;

// Frame Helpers
function createFrame(type, streamId, data) {
    const payload = data ? (Buffer.isBuffer(data) ? data : Buffer.from(data)) : Buffer.alloc(0);
    const length = 1 + 4 + payload.length;

    const header = Buffer.alloc(4);
    header.writeUInt32BE(length, 0);

    const frameHead = Buffer.alloc(5);
    frameHead.writeUInt8(type, 0);
    frameHead.writeUInt32BE(streamId || 0, 1);

    return Buffer.concat([header, frameHead, payload]);
}

class TunnelServer {
    constructor() {
        this.activePorts = new Set(); // Globally track used ports
    }

    start() {
        // Listen on all available interfaces (IPv4/IPv6)
        this.server = net.createServer((socket) => this.handleClient(socket));
        this.server.listen(CONTROL_PORT, () => {
            console.log(`[TunnelServer] Control Server Listening on port ${CONTROL_PORT} (IPv4/IPv6)`);
        });

        this.server.on('error', (err) => {
            console.error(`[TunnelServer] Error: ${err.message}`);
        });
    }

    handleClient(socket) {
        console.log(`[TunnelServer] New connection from ${socket.remoteAddress}`);

        // Client State
        const client = {
            socket,
            isAuthenticated: false,
            allocatedServers: [], // { server, port, protocol }
            streamMap: new Map(), // sid -> net.Socket
            udpSessionMap: new Map(), // sid -> { socket, rinfo }
            udpKeyToSid: new Map(), // "ip:port" -> sid
            nextStreamId: 1,
            buffer: Buffer.alloc(0)
        };

        socket.on('data', (chunk) => {
            client.buffer = Buffer.concat([client.buffer, chunk]);

            while (client.buffer.length >= 4) {
                const length = client.buffer.readUInt32BE(0);
                if (client.buffer.length < 4 + length) {
                    break; // Wait for more data
                }

                const frame = client.buffer.slice(4, 4 + length);
                client.buffer = client.buffer.slice(4 + length);

                const type = frame.readUInt8(0);
                const streamId = frame.readUInt32BE(1);
                const payload = frame.slice(5);

                this.processFrame(client, type, streamId, payload);
            }
        });

        socket.on('close', () => {
            console.log(`[TunnelServer] Client disconnected`);
            this.cleanupClient(client);
        });

        socket.on('error', (err) => {
            console.error(`[TunnelServer] Connection error: ${err.message}`);
            // Cleanup triggers on close
        });
    }

    cleanupClient(client) {
        // Close all allocated servers
        client.allocatedServers.forEach(({ server, port, protocol }) => {
            console.log(`[TunnelServer] Releasing ${protocol} port ${port}`);
            try {
                server.close();
            } catch (e) {
                console.error(`Error closing server on ${port}`, e);
            }
            this.activePorts.delete(port);
        });

        // Close all active TCP streams
        client.streamMap.forEach((socket) => {
            if (!socket.destroyed) socket.destroy();
        });
        client.streamMap.clear();
        client.udpSessionMap.clear();
        client.udpKeyToSid.clear();
    }

    processFrame(client, type, streamId, payload) {
        if (!client.isAuthenticated) {
            if (type === TYPE_AUTH) {
                try {
                    const config = JSON.parse(payload.toString());
                    if (config.secret !== SECRET_KEY) {
                        console.log(`[TunnelServer] Auth failed`);
                        client.socket.end();
                        return;
                    }
                    console.log(`[TunnelServer] Client authenticated. Requesting tunnels...`);
                    client.isAuthenticated = true;
                    this.setupTunnels(client, config.tunnels);
                } catch (e) {
                    console.error('[TunnelServer] Bad auth frame', e);
                    client.socket.end();
                }
            }
            return;
        }

        if (type === TYPE_TCP_DATA) {
            const conn = client.streamMap.get(streamId);
            if (conn && !conn.destroyed) {
                conn.write(payload);
            }
        } else if (type === TYPE_TCP_CLOSE) {
            const conn = client.streamMap.get(streamId);
            if (conn) {
                if (!conn.destroyed) conn.end();
                client.streamMap.delete(streamId);
            }
        } else if (type === TYPE_UDP_DATA) {
            const session = client.udpSessionMap.get(streamId);
            if (session) {
                // Send UDP packet from the Bound Socket to the Remote User
                try {
                    session.socket.send(payload, session.rinfo.port, session.rinfo.address);
                } catch (e) {
                    console.error('[TunnelServer] UDP Send Error', e);
                }
            }
        }
    }

    setupTunnels(client, tunnels) {
        if (!Array.isArray(tunnels)) return;

        tunnels.forEach((tunnel, index) => {
            // Support both 'index' based tunnel mapping and explicit mapping
            const tunnelId = tunnel.id !== undefined ? tunnel.id : index;
            let { protocol, remote } = tunnel;

            // Port Validation & Allocation
            if (remote === 0) {
                remote = this.allocateRandomPort();
                if (!remote) {
                    console.error('[TunnelServer] No ports available');
                    return;
                }
            } else {
                if (remote < 1024 || remote > 65535) {
                    console.error(`[TunnelServer] Port ${remote} rejected. Allowed range: 1024-65535.`);
                    return;
                }
                if (this.activePorts.has(remote)) {
                    console.error(`[TunnelServer] Port ${remote} is allready in use, skipping.`);
                    return;
                }
            }

            if (protocol === 'tcp') {
                const tcpServer = net.createServer((conn) => {
                    const sid = client.nextStreamId++;
                    client.streamMap.set(sid, conn);

                    console.log(`[TunnelServer] TCP New Conn on ${remote} -> sid ${sid}`);
                    client.socket.write(createFrame(TYPE_TCP_OPEN, sid, JSON.stringify({
                        tunnelId,
                        remotePort: remote,
                        protocol: 'tcp'
                    })));

                    conn.on('data', (data) => {
                        client.socket.write(createFrame(TYPE_TCP_DATA, sid, data));
                    });

                    conn.on('close', () => {
                        client.socket.write(createFrame(TYPE_TCP_CLOSE, sid));
                        client.streamMap.delete(sid);
                    });

                    conn.on('error', (err) => {
                        console.error('TCP Conn Error', err.message);
                        client.streamMap.delete(sid);
                    });
                });

                tcpServer.on('error', (err) => {
                    console.error(`[TunnelServer] TCP Server Error on ${remote}: ${err.message}`);
                });

                try {
                    // Bind to all interfaces (IPv4/IPv6) by omitting host
                    tcpServer.listen(remote, () => {
                        console.log(`[TunnelServer] TCP Tunnel allocated: ${remote} (Tunnel ID: ${tunnelId})`);
                    });
                    client.allocatedServers.push({ server: tcpServer, port: remote, protocol: 'tcp' });
                    this.activePorts.add(remote);
                } catch (e) { console.error(e); }

            } else if (protocol === 'udp') {
                const udpSocket = dgram.createSocket('udp4');

                udpSocket.on('message', (msg, rinfo) => {
                    // Identify session by Remote IP:Port
                    const key = `${rinfo.address}:${rinfo.port}`;
                    let sid = client.udpKeyToSid.get(key);

                    if (!sid) {
                        sid = client.nextStreamId++;
                        client.udpKeyToSid.set(key, sid);
                        client.udpSessionMap.set(sid, { socket: udpSocket, rinfo });

                        // Notify Client of new UDP Session
                        client.socket.write(createFrame(TYPE_UDP_OPEN, sid, JSON.stringify({
                            tunnelId,
                            remotePort: remote, // Sending the ACTUAL public port
                            protocol: 'udp'
                        })));
                    }

                    client.socket.write(createFrame(TYPE_UDP_DATA, sid, msg));
                });

                udpSocket.on('error', (err) => {
                    console.error(`[TunnelServer] UDP Socket Error on ${remote}: ${err.message}`);
                });

                try {
                    // For UDP, we stick to IPv4 for now as per requirement, but could be adapted
                    udpSocket.bind(remote, '0.0.0.0', () => {
                        console.log(`[TunnelServer] UDP Tunnel allocated: ${remote} (Tunnel ID: ${tunnelId})`);
                    });
                    client.allocatedServers.push({ server: udpSocket, port: remote, protocol: 'udp' });
                    this.activePorts.add(remote);
                } catch (e) { console.error(e); }
            }
        });
    }

    allocateRandomPort() {
        for (let i = 0; i < 100; i++) {
            const port = Math.floor(Math.random() * (65535 - 1024 + 1)) + 1024;
            if (!this.activePorts.has(port)) return port;
        }
        return null;
    }
}

new TunnelServer().start();
