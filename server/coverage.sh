#!/bin/bash
set -e

# Ensure grcov is available
if ! command -v grcov &> /dev/null; then
    echo "grcov not found in PATH. Adding ~/.cargo/bin to PATH."
    export PATH="$HOME/.cargo/bin:$PATH"
fi

# Navigate to script directory
cd "$(dirname "$0")"

# Clean previous coverage
rm -f *.profraw
rm -rf coverage/

echo "Running tests with instrumentation..."
export RUSTFLAGS="-Cinstrument-coverage"
export LLVM_PROFILE_FILE="server-%p-%m.profraw"

# We use cargo test directly. 
# Note: This might rebuild dependencies if previous build was without instrumentation.
cargo test

echo "Generating coverage report..."
# . is source root (server/)
# -s . source root
# --binary-path target/debug/ where binaries are
# -t html output format
# --branch branch coverage
# --ignore-not-existing ignore missing files
# -o ./coverage/ output dir
grcov . -s . --binary-path ./target/debug/ -t html --branch --ignore-not-existing -o ./coverage/

echo "Coverage report generated at $(pwd)/coverage/index.html"
