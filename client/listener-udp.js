const dgram = require('dgram');
const server = dgram.createSocket('udp4');

server.on('message', (msg, rinfo) => {
    console.log(`Dummy UDP Service: Received ${msg} from ${rinfo.address}:${rinfo.port}`);
    // Echo back
    server.send(Buffer.from('Echo: ' + msg), rinfo.port, rinfo.address);
});

server.bind(3000, () => {
    console.log('Dummy UDP Service listening on 3000');
});
