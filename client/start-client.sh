#!/bin/bash
cd "$(dirname "$0")"

if [ ! -f "config.json" ]; then
    echo "Error: config.json not found."
    exit 1
fi

echo "[TunnelClient] Starting Client..."
node client.js
