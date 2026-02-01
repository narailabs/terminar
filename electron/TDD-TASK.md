# termiNar Electron App - TDD Task

## Overview

Implement a standalone Electron desktop app for the termiNar system. The app wraps the existing Svelte web client and adds native desktop features.

## Reference Specification

See `SPEC-ELECTRON.md` for complete specification including:
- Architecture and component diagrams
- UI/UX design mockups
- Technical implementation details
- Security requirements
- Build and distribution configuration

## Phase 1: Core Shell (MVP)

### Task 1.1: Project Setup

**Create project structure with Vite + Electron:**

```
electron/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── electron-builder.yml
├── src/
│   ├── main/
│   │   └── index.ts
│   ├── preload/
│   │   └── index.ts
│   └── renderer/
│       ├── index.html
│       └── main.ts
└── resources/
    └── (icons)
```

**package.json dependencies:**
- `electron` ^28.0.0
- `electron-store` ^8.0.0
- `vite` ^5.0.0
- `vite-plugin-electron` ^0.28.0
- `vitest` ^1.0.0
- `typescript` ^5.3.0

**Tests required:**
- Build completes without errors
- App launches successfully

### Task 1.2: Main Process Entry Point

**File**: `src/main/index.ts`

Create main process with:
- `app.whenReady()` handler
- Basic BrowserWindow creation
- Load renderer HTML
- Handle `window-all-closed` event
- Handle `activate` event (macOS dock click)

**Tests required:**
- App creates window on ready
- Window loads renderer content
- App quits on all windows closed (Windows/Linux)
- App recreates window on activate (macOS)

### Task 1.3: Window Manager

**File**: `src/main/WindowManager.ts`

```typescript
interface WindowManager {
  createMainWindow(): BrowserWindow;
  showWindow(): void;
  hideWindow(): void;
  toggleWindow(): void;
  getWindow(): BrowserWindow | null;
}
```

**Window configuration:**
- Size: 1200x800 (default)
- Min size: 800x600
- Frame: true (native title bar)
- Context isolation: true
- Node integration: false
- Sandbox: true

**Tests required:**
- Creates window with correct dimensions
- showWindow brings window to front
- hideWindow hides window
- toggleWindow toggles visibility

### Task 1.4: Preload Script

**File**: `src/preload/index.ts`

Expose to renderer via contextBridge:
```typescript
window.electronAPI = {
  minimize: () => void,
  maximize: () => void,
  close: () => void,
  getConfig: () => Promise<Config>,
  setConfig: (key, value) => Promise<void>,
  showNotification: (title, body) => void,
  platform: string,
  getVersion: () => Promise<string>,
  onSessionsChanged: (callback) => void,
  notifySessionsChanged: (sessions) => void,
}
```

**Tests required:**
- electronAPI is exposed to renderer
- IPC calls reach main process
- Config get/set works

### Task 1.5: Load Svelte Web Client

**File**: `src/renderer/main.ts`

- Import and mount App.svelte from `../../web/src/App.svelte`
- Inject electron-specific styles
- Hook into WebSocketSessionManager for session notifications

**File**: `src/renderer/index.html`

- Basic HTML shell with CSP meta tag
- Mount point for Svelte app

**Tests required:**
- Svelte app mounts successfully
- Terminal renders
- WebSocket connection works

### Task 1.6: Basic Menu Bar

**File**: `src/main/MenuManager.ts`

Create application menu:
- File: New Session, Connect, Settings, Quit
- Edit: Copy, Paste, Select All
- View: Zoom In/Out, Reset, Full Screen
- Help: About

**Tests required:**
- Menu bar appears
- Menu items are clickable
- Keyboard shortcuts work

## Phase 2: Desktop Integration

### Task 2.1: System Tray

**File**: `src/main/TrayManager.ts`

```typescript
interface TrayManager {
  create(): Tray;
  updateMenu(sessions: SessionInfo[]): void;
  destroy(): void;
}
```

Tray menu items:
- Session list (dynamic)
- New Session
- Separator
- Settings
- Separator
- Show/Hide
- Quit

**Tests required:**
- Tray icon appears
- Menu updates when sessions change
- Click actions work

### Task 2.2: Minimize to Tray

When close button clicked:
- Hide window instead of quitting
- Show in tray
- Tray click restores window

Quit only via:
- Tray menu "Quit"
- File menu "Quit"
- Keyboard shortcut

**Tests required:**
- Close button hides window
- Tray click shows window
- Quit actually quits

### Task 2.3: Global Shortcuts

**File**: `src/main/ShortcutManager.ts`

Default shortcuts:
- `Cmd/Ctrl+Shift+T`: Show/Hide window
- `Cmd/Ctrl+Shift+N`: New session

**Tests required:**
- Shortcuts register successfully
- Shortcuts trigger actions
- Shortcuts work when app is hidden

### Task 2.4: Native Notifications

Show notifications for:
- Session created
- Session ended
- Connection lost
- Connection restored

**Tests required:**
- Notifications appear
- Click on notification focuses app

### Task 2.5: Auto-Start

**File**: `src/main/AutoStart.ts`

Use `app.setLoginItemSettings()`:
- Enable/disable via settings
- Platform-appropriate implementation

**Tests required:**
- Setting enables login item
- Setting disables login item
- Persists across restart

## Phase 3: Persistence & Polish

### Task 3.1: Config Store

**File**: `src/main/ConfigStore.ts`

Use `electron-store` for:
- Window position/size
- General settings
- Terminal settings
- Connection settings
- Shortcuts

**Tests required:**
- Config saves to disk
- Config loads on startup
- Default values work

### Task 3.2: Window State Persistence

Save on window move/resize:
- Position (x, y)
- Size (width, height)
- Maximized state

Restore on startup.

**Tests required:**
- Position saves
- Position restores
- Maximized state restores

### Task 3.3: Settings Dialog

Create settings UI (can be simple HTML/Svelte):
- General tab
- Terminal tab
- Connection tab
- Shortcuts tab

**Tests required:**
- Settings dialog opens
- Changes save
- Changes apply immediately

### Task 3.4: Secure Token Storage

**File**: `src/main/TokenStore.ts`

Use `keytar` for OS keychain:
- Save token for server
- Get token for server
- Delete token

**Tests required:**
- Token saves securely
- Token retrieves
- Token deletes

## Phase 4: Distribution

### Task 4.1: Build Configuration

**File**: `electron-builder.yml`

Configure for:
- macOS: DMG + ZIP (universal binary)
- Windows: NSIS installer
- Linux: AppImage + deb

**Tests required:**
- Build succeeds for all platforms
- Installer works

### Task 4.2: App Icons

Create icons:
- `icon.icns` (macOS)
- `icon.ico` (Windows)
- `icon.png` (Linux)
- `tray-icon.png` (16x16, 32x32)

### Task 4.3: Auto-Update

**File**: `src/main/AutoUpdater.ts`

Use `electron-updater`:
- Check for updates on startup
- Download in background
- Prompt to restart

**Tests required:**
- Update check works
- Update download works
- Update applies on restart

## Test Commands

```bash
# Unit tests
cd apps/terminar/electron && pnpm test

# Build
cd apps/terminar/electron && pnpm build

# Run in development
cd apps/terminar/electron && pnpm dev
```

## Success Criteria

1. All tests pass
2. App launches and connects to server
3. Terminal works (input/output)
4. Tray icon with session list
5. Global shortcuts work
6. Settings persist
7. Builds for macOS/Windows/Linux
