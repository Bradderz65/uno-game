#!/bin/bash

echo ""
echo "========================================"
echo "   UNO Public Sharing"
echo "========================================"
echo ""
echo "Creating a public URL for your local game..."
echo "Ensure your game server is already running (./launch.sh)"
echo ""

# Use npx to run localtunnel without global installation
echo "Starting tunnel..."
echo ""
# Fetch public IP for the password
IP=$(curl -s https://loca.lt/mytunnelpassword)
echo "-------------------------------------------------------"
echo "  Tunnel Password: $IP"
echo "-------------------------------------------------------"
echo "(Your guest will need to enter this password on the page)"
echo ""
echo "Copy the URL below and send it to your friend:"
echo ""

npx localtunnel --port 3000
