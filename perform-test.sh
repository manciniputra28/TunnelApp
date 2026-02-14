#!/bin/bash
REMOTE_HOST="x3lxbhrf9h9u9ygt3cwd35prquvgxykj.vryakn.web.id"

echo "Checking remote Node.js installation..."
if ! ssh aws "node -v" >/dev/null 2>&1; then
    echo "Wait! Node.js is still installing on the remote server."
    echo "Please wait a few minutes and try again."
    exit 1
fi

echo "Ensuring remote server is running..."
# Using pgrep to check if node server.js is running, if not start it
ssh aws "pgrep -f 'node server.js' || (cd ~/TunnelApp/server && nohup ./start-server.sh > server.log 2>&1 &)"

# 1. Start Local Test Servers
./start-test-servers.sh

# 2. Start Client
echo "Starting Client..."
# Kill any existing client
pkill -f "node client/client.js"
nohup node client/client.js > client.log 2>&1 &
CLIENT_PID=$!

# 3. Check connectivity
echo "Waiting for client connection..."
CONNECTED=0
for i in {1..20}; do
    if grep -q "Connected!" client.log; then
        echo "Client Connected!"
        CONNECTED=1
        break
    fi
    sleep 2
done

if [ $CONNECTED -eq 0 ]; then
    echo "Client failed to connect. Logs:"
    cat client.log
    kill $CLIENT_PID
    exit 1
fi

# 4. Test TCP Tunnel
echo "Testing TCP Tunnel (Remote 8080 -> Local 8000)..."
curl -I --connect-timeout 5 http://$REMOTE_HOST:8080
if [ $? -eq 0 ]; then
    echo "TCP Tunnel WORKED!"
else
    echo "TCP Tunnel FAILED!"
fi

# 5. Get Random UDP Port from Server Logs
echo "Fetching Remote UDP Port..."
UDP_PORT=""
for i in {1..5}; do
    # Fetch log from remote
    ssh aws "grep 'UDP Tunnel allocated' ~/TunnelApp/server/server.log" > udp_ports.txt
    UDP_PORT=$(tail -n 1 udp_ports.txt | grep -oE '[0-9]+' | head -n 1)
    if [ -n "$UDP_PORT" ]; then break; fi
    sleep 2
done

if [ -z "$UDP_PORT" ]; then
    echo "Could not find UDP port in server logs."
else
    echo "Testing UDP Tunnel (Remote $UDP_PORT -> Local 3000)..."
    echo "PING_TEST" | nc -u -w 2 $REMOTE_HOST $UDP_PORT
    echo " (Check local udp_server.log for receipt)"
fi

# Cleanup
kill $CLIENT_PID
pkill -f "python3 -m http.server"
pkill -f "node client/listener-udp.js"
