#!/usr/bin/env bash
# dev-fresh.sh — kill everything, clean all artifacts, full rebuild, then run
# server + tray.
#
# The server is started DETACHED via npm/terminar/lib/server-manager.js (the
# same module `pnpm dev` and the production `terminar` CLI use). That means
# closing the tray or Ctrl+C'ing this script does NOT kill the server — your
# PTY sessions survive. Use `pnpm server:stop` to stop the server explicitly.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO"

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[0;33m'; BOLD='\033[1m'; NC='\033[0m'
step() { echo -e "\n${BOLD}${CYAN}▶ $*${NC}"; }
ok()   { echo -e "${GREEN}✓ $*${NC}"; }
warn() { echo -e "${YELLOW}⚠ $*${NC}"; }

# ── Cleanup on exit ───────────────────────────────────────────────────────────
# The Rust PTY server is detached and intentionally stays alive; the tray runs
# in the foreground and exits on its own.
cleanup() {
  local exit_code=$?
  set +e
  # If the server was started in this run, tell the user where to go next.
  if [[ -f "$HOME/.terminar/server.pid" ]]; then
    local server_pid
    server_pid=$(cat "$HOME/.terminar/server.pid" 2>/dev/null || echo "?")
    echo ""
    if [[ $exit_code -eq 0 ]]; then
      echo -e "${GREEN}▶ UI closed. Server still running (PID ${server_pid}).${NC}"
    else
      echo -e "${GREEN}▶ Exited (code ${exit_code}). Server still running (PID ${server_pid}).${NC}"
    fi
    echo "  - Reopen UI:   pnpm dev  (or ./dev-fresh.sh for a fresh rebuild)"
    echo "  - Stop server: pnpm server:stop"
    echo "  - Server logs: pnpm server:logs"
  fi
}
trap cleanup EXIT

# ── Kill any existing terminar Electron processes ─────────────────────────────
# Needs its own function because the real Electron binary lives under
# node_modules/.pnpm/electron@.../... — the old `pkill -f $REPO/tray/...`
# patterns didn't match. We identify terminar's Electron processes by their
# shared user-data-dir (`~/Library/Application Support/terminar`), then kill
# both the helpers and their main-process parents.
kill_terminar_electron() {
  local helpers
  helpers=$(pgrep -f "Library/Application Support/terminar" 2>/dev/null || true)
  if [[ -z "$helpers" ]]; then
    return 0
  fi
  # Kill the main Electron process (parent of each helper)
  local pid parent
  for pid in $helpers; do
    parent=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ' || true)
    if [[ -n "$parent" && "$parent" != "1" && "$parent" != "0" ]]; then
      kill -9 "$parent" 2>/dev/null || true
    fi
  done
  # Kill the helpers themselves (in case the main was already gone)
  for pid in $helpers; do
    kill -9 "$pid" 2>/dev/null || true
  done
}

# ── 1. Kill all project processes ─────────────────────────────────────────────
step "Killing all project processes..."
kill_terminar_electron
pkill -9 -f "$REPO/server/target/.*/terminar-server" 2>/dev/null || true
pkill -9 -f "$REPO/tray/node_modules" 2>/dev/null || true
pkill -9 -f "$REPO/web/node_modules" 2>/dev/null || true
pkill -9 -f "$REPO/scripts/dev\.cjs" 2>/dev/null || true
pkill -9 -f "$REPO/node_modules/\.bin" 2>/dev/null || true
# Give ports a moment to free
sleep 1
# Clean up stale PID file if process is gone — server-manager.js also handles
# this, but doing it explicitly here makes the "fresh" semantic obvious.
if [[ -f "$HOME/.terminar/server.pid" ]]; then
  PID=$(cat "$HOME/.terminar/server.pid" 2>/dev/null || echo "")
  if [[ -n "$PID" ]] && ! kill -0 "$PID" 2>/dev/null; then
    rm -f "$HOME/.terminar/server.pid"
  fi
fi
ok "Processes killed"

# ── 2. Clean all build artifacts ──────────────────────────────────────────────
step "Cleaning build artifacts..."
rm -rf \
  "$REPO/server/target" \
  "$REPO/web/dist" \
  "$REPO/web/node_modules/.vite" \
  "$REPO/web/test-results" \
  "$REPO/tray/dist" \
  "$REPO/tray/dist-electron" \
  "$REPO/tray/node_modules/.vite" \
  "$REPO/tray/test-results" \
  "$REPO/electron/node_modules/.vite" \
  "$REPO/extension/out" \
  "$REPO/extension/out-test" \
  "$REPO/packages/shell-protocol/dist" \
  "$REPO/packages/terminar-ui/dist"
find "$REPO" -not -path "*/node_modules/*" -name "*.tsbuildinfo" -delete 2>/dev/null || true
find "$REPO" -type d -name ".vite" -exec rm -rf {} + 2>/dev/null || true
find "$REPO" -not -path "*/node_modules/*" -type d \( -name "playwright-report" \) -exec rm -rf {} + 2>/dev/null || true
ok "Artifacts cleaned"

# ── 3. Build: shell-protocol ──────────────────────────────────────────────────
step "Building shell-protocol..."
cd "$REPO/packages/shell-protocol"
pnpm build
ok "shell-protocol built"

# ── 4. Build: Rust server (release) ───────────────────────────────────────────
step "Building server (release)..."
cd "$REPO/server"
PATH="$HOME/.cargo/bin:$PATH" cargo build --release
ok "Server built"

# ── 5. Start server (DETACHED — survives Ctrl+C and UI close) ─────────────────
step "Starting server (detached, Unix socket only)..."
cd "$REPO"
SERVER_BIN="$REPO/server/target/release/terminar-server"
# server-manager.js handles: detached:true + unref() + PID file + macOS codesign
node -e '
  const sm = require("./npm/terminar/lib/server-manager.js");
  const bin = process.argv[1];
  (async () => {
    const existing = sm.getRunningPid();
    if (existing) {
      console.log("Server already running (PID " + existing + ")");
      return;
    }
    sm.start(bin, 6750);
    // The server is Unix-socket-only (no HTTP /health endpoint) — wait for the
    // socket file to appear instead of polling health.
    await sm.waitForSocketReady(sm.defaultSocketPath(), 10000);
  })().catch(e => { console.error(e.message || e); process.exit(1); });
' "$SERVER_BIN"
ok "Server ready (logs: ~/.terminar/logs/server.log)"

# ── 6. Start tray (foreground — this waits until the tray exits) ──────────────
# The tray mounts web/App.svelte with Vite HMR; there is no separate browser
# dev server (a browser can't reach the Unix socket).
step "Starting tray..."
cd "$REPO/tray"
pnpm dev
