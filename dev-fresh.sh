#!/usr/bin/env bash
# dev-fresh.sh — kill everything, clean all artifacts, full rebuild, then run server + tray.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO"

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
step() { echo -e "\n${BOLD}${CYAN}▶ $*${NC}"; }
ok()   { echo -e "${GREEN}✓ $*${NC}"; }

# ── Cleanup on exit ───────────────────────────────────────────────────────────
SERVER_PID=""
WEB_PID=""
cleanup() {
  echo -e "\n${RED}→ Shutting down...${NC}"
  [[ -n "$SERVER_PID" ]] && kill "$SERVER_PID" 2>/dev/null || true
  [[ -n "$WEB_PID" ]] && kill "$WEB_PID" 2>/dev/null || true
  pkill -f "$REPO/server/target/release/terminar-server" 2>/dev/null || true
  pkill -f "$REPO/web/node_modules" 2>/dev/null || true
  pkill -f "$REPO/tray/node_modules" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# ── 1. Kill all project processes ─────────────────────────────────────────────
step "Killing all project processes..."
pkill -9 -f "terminar-server" 2>/dev/null || true
pkill -9 -f "$REPO/tray/node_modules" 2>/dev/null || true
pkill -9 -f "$REPO/web/node_modules" 2>/dev/null || true
pkill -9 -f "$REPO/node_modules/.bin" 2>/dev/null || true
# Give ports a moment to free
sleep 1
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

# ── 5. Build: web frontend ────────────────────────────────────────────────────
step "Building web frontend..."
cd "$REPO/web"
pnpm build
ok "Web frontend built"

# ── 6. Start server ───────────────────────────────────────────────────────────
step "Starting server on :6750..."
cd "$REPO"
server/target/release/terminar-server --no-auth --port 6750 &
SERVER_PID=$!

# Wait up to 10s for server to be ready
for i in $(seq 1 20); do
  if curl -sf http://127.0.0.1:6750/health >/dev/null 2>&1; then
    ok "Server ready (pid $SERVER_PID)"
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo -e "${RED}✗ Server process died. Check output above.${NC}"
    exit 1
  fi
  sleep 0.5
done

# ── 7. Start web dev server ───────────────────────────────────────────────────
step "Starting web dev server on :3001..."
cd "$REPO/web"
pnpm dev &
WEB_PID=$!
ok "Web dev server started (pid $WEB_PID) → http://localhost:3001"

# ── 8. Start tray (foreground) ────────────────────────────────────────────────
step "Starting tray..."
cd "$REPO/tray"
pnpm dev
