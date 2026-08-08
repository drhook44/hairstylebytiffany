#!/bin/bash
# Keep alive script for Hair Style by Tiffany
TUNNEL_LOG="/tmp/cloudflared-tunnel.log"
SERVER_LOG="/tmp/hsbt-server.log"
URL_FILE="/tmp/hsbt-current-url.txt"

# Ensure server is running
if ! curl -s -o /dev/null http://localhost:3033/ 2>/dev/null; then
  cd /workspace/hairstylebytiffany && nohup node server.js > "$SERVER_LOG" 2>&1 &
  sleep 3
fi

# Check tunnel via log
if ! grep -q "Registered tunnel connection" "$TUNNEL_LOG" 2>/dev/null; then
  nohup /tmp/cloudflared tunnel --url http://localhost:3033 --no-tls-verify > "$TUNNEL_LOG" 2>&1 &
  sleep 10
fi

# Save current URL
URL=$(grep -oP 'https://[a-z-]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | tail -1)
[ -n "$URL" ] && echo "$URL" > "$URL_FILE"
cat "$URL_FILE" 2>/dev/null || echo "waiting..."