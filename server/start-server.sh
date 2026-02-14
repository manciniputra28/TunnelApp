#!/bin/bash
cd "$(dirname "$0")"

export CONTROL_PORT=5000
export SECRET_KEY="mysupersecretpassword"

echo "[TunnelServer] Starting on Port $CONTROL_PORT..."
node server.js
