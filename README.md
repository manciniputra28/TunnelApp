# Custom TCP/UDP Tunnel (Pure Node.js)

A lightweight, dependency-free reverse tunnel implementation for TCP and UDP traffic.
Separated into Server (AWS/VPS) and Client (Local) components.

## Directory Structure

```
TunnelApp/
├── server/          # Deploy this to your AWS/VPS
│   ├── server.js
│   └── start-server.sh
├── client/          # Run this on your local machine
│   ├── client.js
│   └── config.json
└── README.md
```

## Deployment

### 1. Server Side (AWS/VPS)
1. Upload the `server/` folder to your AWS instance.
2. Navigate to the folder:
   ```bash
   cd server
   ```
3. Allow **TCP 5000** and your desired port range (1024-65535) in your Firewall/AWS Security Group.
4. Run the server:
   ```bash
   ./start-server.sh
   # Or manually:
   # export CONTROL_PORT=5000; export SECRET_KEY="..."; node server.js
   ```

### 2. Client Side (Local Machine)
1. Navigate to the client folder:
   ```bash
   cd client
   ```
2. Configure `config.json`:
   ```json
   {
     "server": "YOUR_AWS_PUBLIC_IP_OR_DOMAIN",
     "controlPort": 5000,
     "secret": "mysupersecretpassword",
     "tunnels": [
       { "protocol": "tcp", "remote": 8080, "local": 80 },
       { "protocol": "udp", "remote": 0, "local": 3000 }
     ]
   }
   ```
3. Run the client:
   ```bash
   node client.js
   ```

## Architecture
- **Control Channel**: TCP (Port 5000)
- **Multiplexing**: Single connection handles multiple tunnels.
- **Protocol**: Custom binary framing for low overhead.
