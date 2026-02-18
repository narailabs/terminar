#!/bin/bash
# Post-installation script for terminar .deb package
# Sets up the server binary permissions and creates required directories

set -e

# Make the bundled server binary executable
BINARY_PATH="/opt/terminar/resources/bin/terminar-server"
if [ -f "$BINARY_PATH" ]; then
    chmod +x "$BINARY_PATH"
fi

# Create data directory
mkdir -p /var/lib/terminar
chmod 750 /var/lib/terminar

echo "terminar installed successfully."
echo "Launch from the application menu or run 'terminar' from the terminal."
