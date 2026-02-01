#!/bin/bash
set -e

# Hardcoded path for this environment
CARGO_BIN="/Users/narayan/.cargo/bin/cargo"

# 1. Locate directory
PROJECT_DIR="apps/terminar/server"

if [ ! -f "$PROJECT_DIR/Cargo.toml" ]; then
    FOUND=$(find . -type f -name Cargo.toml | grep "apps/terminar/server" | xargs dirname | head -n 1)
    if [ -n "$FOUND" ]; then
        PROJECT_DIR="$FOUND"
    fi
fi

if [ -z "$PROJECT_DIR" ] || [ ! -d "$PROJECT_DIR" ]; then
    echo "Error: Could not find directory for terminar-server"
    exit 1
fi

cd "$PROJECT_DIR"

# 2. Check for Cargo
if [ -f "$CARGO_BIN" ]; then
    echo "Found cargo at $CARGO_BIN"
    CMD="$CARGO_BIN"
elif command -v cargo &> /dev/null; then
    echo "Found cargo in PATH"
    CMD="cargo"
else
    echo "ERROR: 'cargo' not found."
    exit 1
fi

# 3. Run tests
echo "Running '$CMD test'..."
"$CMD" test