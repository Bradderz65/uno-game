#!/bin/bash

echo ""
echo "========================================"
echo "   UNO Multiplayer - Starting..."
echo "========================================"
echo ""

# Start the server in background and capture logs
node server/index.js > server.log 2>&1 &
SERVER_PID=$!

# Cleanup function to be called on exit
cleanup() {
    echo ""
    echo "Stopping server..."
    kill $SERVER_PID 2>/dev/null
    rm server.log 2>/dev/null
    echo "Done!"
    exit
}

# Trap SIGINT (Ctrl+C) and SIGTERM
trap cleanup SIGINT SIGTERM

# Wait for server to be ready
echo "Waiting for server to start..."
max_attempts=30
count=0
while ! grep -q "UNO Server Started" server.log; do
    sleep 1
    count=$((count+1))
    if [ $count -ge $max_attempts ]; then
        echo "Error: Server failed to start or log output not found."
        cleanup
    fi
done

echo "Server is ready!"
echo ""

# Get network URL from log
NETWORK_URL=$(grep "Network:" server.log | head -n 1 | awk '{print $2}')

echo "Opening browser..."
echo ""
echo "========================================"
echo "   Local:   http://localhost:3000"
echo "   Network: $NETWORK_URL"
echo "========================================"
echo ""
echo "Share the Network URL with other players!"
echo ""

# Open browser based on OS (Linux/macOS)
if command -v xdg-open > /dev/null; then
  xdg-open http://localhost:3000
elif command -v open > /dev/null; then
  open http://localhost:3000
fi

echo "Press Ctrl+C to stop the server and exit..."
echo ""

# Wait for the background process
wait $SERVER_PID
