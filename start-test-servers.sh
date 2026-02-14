#!/bin/bash
pkill -f "python3 -m http.server 8000"
pkill -f "node client/listener-udp.js"

echo "Starting HTTP Server on 8000..."
nohup python3 -m http.server 8000 > http_server.log 2>&1 &
echo "Starting UDP Echo Server on 3000..."
nohup node client/listener-udp.js > udp_server.log 2>&1 &

echo "Test servers running!"
