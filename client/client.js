const net = require('net');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');

// Load Config
let config = {};
try {
    const configPath = path.join(__dirname, 'config.json');
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (e) {
    console.error('Failed to load config.json:', e.message);
    process.exit(1);
}

const SERVER_HOST = config.server || '127.0.0.1';
const SERVER_PORT = config.controlPort || 5000;
const SECRET_KEY = config.secret || 'changeme';

// Protocol Types
const TYPE_AUTH = 0;
const TYPE_TCP_OPEN = 1;
const TYPE_TCP_DATA = 2;
const TYPE_TCP_CLOSE = 3;
const TYPE_UDP_OPEN = 4;
const TYPE_UDP_DATA = 5;

// Frame Helper
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

class TunnelClient {
    constructor() {
        this.socket = null;
        this.streamMap = new Map(); // sid -> net.Socket
        this.udpSessionMap = new Map(); // sid -> dgram.Socket
        this.buffer = Buffer.alloc(0);
    }

    start() {
        this.connect();
    }

    connect() {
        console.log(`[TunnelClient] Connecting to ${SERVER_HOST}:${SERVER_PORT}...`);
        this.socket = net.connect(SERVER_PORT, SERVER_HOST);

        this.socket.on('connect', () => {
            console.log(`[TunnelClient] Connected! sending auth...`);
            // Assign IDs to tunnels to map them back later
            const tunnelsWithIds = config.tunnels.map((t, idx) => ({ ...t, id: idx }));
            const authPayload = JSON.stringify({
                secret: SECRET_KEY,
                tunnels: tunnelsWithIds
            });
            this.socket.write(createFrame(TYPE_AUTH, 0, authPayload));
        });

        this.socket.on('data', (chunk) => {
            this.buffer = Buffer.concat([this.buffer, chunk]);
            while (this.buffer.length >= 4) {
                const length = this.buffer.readUInt32BE(0);
                if (this.buffer.length < 4 + length) break;

                const frame = this.buffer.slice(4, 4 + length);
                this.buffer = this.buffer.slice(4 + length);

                const type = frame.readUInt8(0);
                const streamId = frame.readUInt32BE(1);
                const payload = frame.slice(5);

                this.processFrame(type, streamId, payload);
            }
        });

        this.socket.on('close', () => {
            console.log(`[TunnelClient] Connection closed. Reconnecting in 3s...`);
            this.cleanup();
            setTimeout(() => this.connect(), 3000);
        });

        this.socket.on('error', (err) => {
            console.error(`[TunnelClient] Error: ${err.message}`);
        });
    }

    cleanup() {
        this.streamMap.forEach(s => s.destroy());
        this.streamMap.clear();
        this.udpSessionMap.forEach(s => s.close());
        this.udpSessionMap.clear();
        this.buffer = Buffer.alloc(0);
    }

    processFrame(type, streamId, payload) {
        if (type === TYPE_TCP_OPEN) {
            const meta = JSON.parse(payload.toString());
            const tunnelId = meta.tunnelId;
            console.log(`[TunnelClient] New TCP Stream ${streamId} for TunnelID ${tunnelId} (Remote: ${meta.remotePort})`);

            // Find local port by ID
            const tunnelDef = config.tunnels[tunnelId];
            if (!tunnelDef) {
                console.error(`[TunnelClient] No tunnel def for ID ${tunnelId}`);
                this.socket.write(createFrame(TYPE_TCP_CLOSE, streamId));
                return;
            }

            const localSocket = net.connect(tunnelDef.local, '127.0.0.1'); // Assuming local is on localhost
            this.streamMap.set(streamId, localSocket);

            localSocket.on('connect', () => {
                // Connection established to local service
            });

            localSocket.on('data', (data) => {
                this.socket.write(createFrame(TYPE_TCP_DATA, streamId, data));
            });

            localSocket.on('close', () => {
                this.socket.write(createFrame(TYPE_TCP_CLOSE, streamId));
                this.streamMap.delete(streamId);
            });

            localSocket.on('error', (err) => {
                console.error(`[TunnelClient] Local Socket Error: ${err.message}`);
                this.socket.write(createFrame(TYPE_TCP_CLOSE, streamId));
            });

        } else if (type === TYPE_TCP_DATA) {
            const socket = this.streamMap.get(streamId);
            if (socket) socket.write(payload);

        } else if (type === TYPE_TCP_CLOSE) {
            const socket = this.streamMap.get(streamId);
            if (socket) {
                socket.end();
                this.streamMap.delete(streamId);
            }

        } else if (type === TYPE_UDP_OPEN) {
            const meta = JSON.parse(payload.toString());
            const tunnelId = meta.tunnelId;
            // console.log(`[TunnelClient] New UDP Session ${streamId}`);

            const tunnelDef = config.tunnels[tunnelId];
            if (!tunnelDef) {
                return;
            }

            const udpSocket = dgram.createSocket('udp4');
            this.udpSessionMap.set(streamId, udpSocket);

            udpSocket.on('message', (msg) => {
                // Reply from Local Service -> Send to Server
                this.socket.write(createFrame(TYPE_UDP_DATA, streamId, msg));
            });

            // We don't bind to a specific port, let OS pick random.
            // But we need to store the target info to send subsequent DATA frames.
            udpSocket.targetPort = tunnelDef.local;
            udpSocket.targetHost = '127.0.0.1';

        } else if (type === TYPE_UDP_DATA) {
            const udpSocket = this.udpSessionMap.get(streamId);
            if (udpSocket) {
                udpSocket.send(payload, udpSocket.targetPort, udpSocket.targetHost);
            }
        }
    }
}

new TunnelClient().start();
