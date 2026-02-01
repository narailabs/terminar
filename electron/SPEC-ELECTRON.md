# termiNar - Electron Desktop App Specification

**Version**: 1.0
**Status**: Draft
**Last Updated**: January 17, 2026

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Architecture](#2-architecture)
3. [Features](#3-features)
4. [UI/UX Design](#4-uiux-design)
5. [Technical Implementation](#5-technical-implementation)
6. [Security](#6-security)
7. [Configuration](#7-configuration)
8. [Build & Distribution](#8-build--distribution)
9. [Testing Strategy](#9-testing-strategy)
10. [File Structure](#10-file-structure)

---

## 1. Introduction

### 1.1 Purpose

The Electron desktop app provides a standalone, native application for accessing persistent shell sessions. It wraps the existing Svelte web client with native desktop capabilities including system tray integration, auto-start, and native notifications.

### 1.2 Goals

| Goal | Description |
|------|-------------|
| **Native Experience** | Desktop app that feels like a native terminal application |
| **System Integration** | System tray, auto-start, global shortcuts |
| **Offline First** | Works with local server, no internet required |
| **Cross-Platform** | macOS, Windows, Linux support |
| **Code Reuse** | Leverage existing Svelte web client |

### 1.3 Non-Goals

- Replacing the VS Code extension (different use case)
- Embedded server (server runs separately)
- Mobile support (desktop only)
- Terminal multiplexing (handled by server)

---

## 2. Architecture

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    ELECTRON APP                              │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────┐    │
│  │              MAIN PROCESS (Node.js)                  │    │
│  │  ┌─────────────┐ ┌─────────────┐ ┌───────────────┐  │    │
│  │  │   Window    │ │   Tray      │ │   IPC         │  │    │
│  │  │   Manager   │ │   Manager   │ │   Handler     │  │    │
│  │  └─────────────┘ └─────────────┘ └───────────────┘  │    │
│  │  ┌─────────────┐ ┌─────────────┐ ┌───────────────┐  │    │
│  │  │   Config    │ │   Auto      │ │   Server      │  │    │
│  │  │   Store     │ │   Updater   │ │   Discovery   │  │    │
│  │  └─────────────┘ └─────────────┘ └───────────────┘  │    │
│  └─────────────────────────────────────────────────────┘    │
│                           │ IPC                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │           RENDERER PROCESS (Chromium)                │    │
│  │  ┌─────────────────────────────────────────────┐    │    │
│  │  │           SVELTE WEB CLIENT                  │    │    │
│  │  │  ┌─────────────┐ ┌─────────────────────┐    │    │    │
│  │  │  │   App.svelte│ │  Terminal.svelte    │    │    │    │
│  │  │  └─────────────┘ └─────────────────────┘    │    │    │
│  │  │  ┌─────────────────────────────────────┐    │    │    │
│  │  │  │     WebSocketSessionManager         │    │    │    │
│  │  │  └─────────────────────────────────────┘    │    │    │
│  │  └─────────────────────────────────────────────┘    │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ WebSocket
                              ▼
                    ┌─────────────────┐
                    │   RUST SERVER   │
                    │  (persistent-   │
                    │   shell-server) │
                    └─────────────────┘
```

### 2.2 Process Model

| Process | Role | Technologies |
|---------|------|--------------|
| Main | Window management, system integration, IPC | Node.js, Electron APIs |
| Renderer | UI rendering, terminal display | Chromium, Svelte, xterm.js |
| Preload | Secure bridge between main and renderer | contextBridge, ipcRenderer |

---

## 3. Features

### 3.1 Core Features

#### 3.1.1 Session Management

| Feature | Description |
|---------|-------------|
| List sessions | Display all active sessions from server |
| Create session | Create new shell session with custom shell/cwd |
| Attach/Detach | Connect to and disconnect from sessions |
| Rename session | Change session display name |
| Kill session | Terminate a session |

#### 3.1.2 Terminal

| Feature | Description |
|---------|-------------|
| xterm.js rendering | Full terminal emulation with xterm.js |
| History replay | See previous output when attaching |
| Resize handling | Terminal resizes with window |
| Copy/Paste | Native clipboard integration |
| Search | Search through terminal history |

### 3.2 Desktop Integration

#### 3.2.1 System Tray

```
┌─────────────────────────┐
│ 🖥️  termiNar     │
├─────────────────────────┤
│ ● Session 1 (bash)      │
│ ● Session 2 (zsh)       │
│ ○ Session 3 (idle)      │
├─────────────────────────┤
│ + New Session           │
│ ─────────────────────── │
│ ⚙️  Settings             │
│ ─────────────────────── │
│ ✖️  Quit                 │
└─────────────────────────┘
```

| Tray Feature | Description |
|--------------|-------------|
| Session list | Quick access to all sessions |
| Status indicators | Green (active), gray (idle) |
| New session | Create session from tray |
| Show/Hide window | Toggle main window visibility |
| Quit | Exit application completely |

#### 3.2.2 Auto-Start

| Platform | Implementation |
|----------|----------------|
| macOS | Login Items via `app.setLoginItemSettings()` |
| Windows | Registry via `app.setLoginItemSettings()` |
| Linux | XDG autostart desktop entry |

#### 3.2.3 Global Shortcuts

| Shortcut | Action | Default |
|----------|--------|---------|
| Show/Hide | Toggle window visibility | `Cmd/Ctrl+Shift+T` |
| New Session | Create new session | `Cmd/Ctrl+Shift+N` |
| Next Session | Switch to next session | `Cmd/Ctrl+Tab` |
| Prev Session | Switch to previous session | `Cmd/Ctrl+Shift+Tab` |

#### 3.2.4 Notifications

| Event | Notification |
|-------|--------------|
| Session created | "New session 'name' created" |
| Session ended | "Session 'name' ended" |
| Connection lost | "Connection to server lost" |
| Connection restored | "Reconnected to server" |

### 3.3 Window Management

#### 3.3.1 Window Features

| Feature | Description |
|---------|-------------|
| Remember position | Restore window position on restart |
| Remember size | Restore window size on restart |
| Multiple windows | Support for multiple windows (future) |
| Always on top | Optional always-on-top mode |
| Minimize to tray | Close button minimizes to tray |

#### 3.3.2 Menu Bar

```
File    Edit    View    Session    Help
```

| Menu | Items |
|------|-------|
| File | New Session, Connect to Server, Settings, Quit |
| Edit | Copy, Paste, Select All, Find |
| View | Zoom In, Zoom Out, Reset Zoom, Toggle Full Screen |
| Session | List Sessions, Rename, Kill, Detach |
| Help | Documentation, Check for Updates, About |

---

## 4. UI/UX Design

### 4.1 Main Window Layout

```
┌─────────────────────────────────────────────────────────────┐
│ ☰  termiNar                              _ □ ✕     │
├─────────────────────────────────────────────────────────────┤
│ ┌─────────────────┐ ┌─────────────────────────────────────┐ │
│ │ SESSIONS        │ │                                     │ │
│ │ ┌─────────────┐ │ │  user@host:~$                       │ │
│ │ │● Session 1  │ │ │  $ ls -la                           │ │
│ │ │  /bin/bash  │ │ │  total 24                           │ │
│ │ └─────────────┘ │ │  drwxr-xr-x  5 user user 160 Jan 17 │ │
│ │ ┌─────────────┐ │ │  -rw-r--r--  1 user user 123 Jan 17 │ │
│ │ │○ Session 2  │ │ │  $ _                                │ │
│ │ │  /bin/zsh   │ │ │                                     │ │
│ │ └─────────────┘ │ │                                     │ │
│ │                 │ │                                     │ │
│ │ [+ New Session] │ │                                     │ │
│ └─────────────────┘ └─────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│ Connected to localhost:3000 | 2 sessions | RAM: 45MB       │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 Connection Dialog

```
┌─────────────────────────────────────┐
│        Connect to Server            │
├─────────────────────────────────────┤
│                                     │
│  Server URL:                        │
│  ┌─────────────────────────────┐   │
│  │ ws://localhost:3000         │   │
│  └─────────────────────────────┘   │
│                                     │
│  ○ Token Authentication             │
│    ┌─────────────────────────────┐ │
│    │ ••••••••••••••••••••••••••• │ │
│    └─────────────────────────────┘ │
│                                     │
│  ○ Pairing Code                     │
│    ┌─────────────────────────────┐ │
│    │ Enter 6-digit code          │ │
│    └─────────────────────────────┘ │
│                                     │
│  ☐ Remember this server            │
│  ☐ Connect automatically           │
│                                     │
│       [Cancel]    [Connect]         │
└─────────────────────────────────────┘
```

### 4.3 Settings Dialog

```
┌─────────────────────────────────────────────────────────────┐
│                        Settings                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  GENERAL                                                     │
│  ├─ ☑ Start at login                                        │
│  ├─ ☑ Minimize to tray on close                             │
│  ├─ ☑ Show tray icon                                        │
│  └─ ☐ Always on top                                         │
│                                                              │
│  TERMINAL                                                    │
│  ├─ Font family: [Menlo____________▾]                       │
│  ├─ Font size:   [14___] px                                 │
│  ├─ Theme:       [Dark (default)___▾]                       │
│  └─ Scrollback:  [10000] lines                              │
│                                                              │
│  SHORTCUTS                                                   │
│  ├─ Show/Hide:    [Cmd+Shift+T_____]                        │
│  ├─ New Session:  [Cmd+Shift+N_____]                        │
│  └─ Quick Switch: [Cmd+Tab_________]                        │
│                                                              │
│  CONNECTION                                                  │
│  ├─ Default server: [ws://localhost:3000]                   │
│  ├─ ☑ Auto-reconnect                                        │
│  └─ Reconnect delay: [5___] seconds                         │
│                                                              │
│                              [Cancel]    [Save]              │
└─────────────────────────────────────────────────────────────┘
```

### 4.4 Themes

| Theme | Background | Foreground | Accent |
|-------|------------|------------|--------|
| Dark (default) | #1e1e1e | #d4d4d4 | #007acc |
| Light | #ffffff | #1e1e1e | #0066cc |
| Solarized Dark | #002b36 | #839496 | #268bd2 |
| Solarized Light | #fdf6e3 | #657b83 | #268bd2 |
| Dracula | #282a36 | #f8f8f2 | #bd93f9 |

---

## 5. Technical Implementation

### 5.1 Main Process Modules

#### 5.1.1 WindowManager

```typescript
// src/main/WindowManager.ts
interface WindowManager {
  createMainWindow(): BrowserWindow;
  showWindow(): void;
  hideWindow(): void;
  toggleWindow(): void;
  saveWindowState(): void;
  restoreWindowState(): void;
}
```

**Responsibilities**:
- Create and manage BrowserWindow instances
- Save/restore window position and size
- Handle minimize to tray behavior
- Manage always-on-top setting

#### 5.1.2 TrayManager

```typescript
// src/main/TrayManager.ts
interface TrayManager {
  create(): Tray;
  updateMenu(sessions: SessionInfo[]): void;
  showBalloon(title: string, content: string): void;
  destroy(): void;
}
```

**Responsibilities**:
- Create and manage system tray icon
- Build dynamic context menu with sessions
- Handle tray click events
- Show native notifications

#### 5.1.3 ConfigStore

```typescript
// src/main/ConfigStore.ts
interface Config {
  window: {
    x: number;
    y: number;
    width: number;
    height: number;
    maximized: boolean;
  };
  general: {
    startAtLogin: boolean;
    minimizeToTray: boolean;
    showTrayIcon: boolean;
    alwaysOnTop: boolean;
  };
  terminal: {
    fontFamily: string;
    fontSize: number;
    theme: string;
    scrollback: number;
  };
  connection: {
    defaultServer: string;
    autoReconnect: boolean;
    reconnectDelay: number;
    savedServers: SavedServer[];
  };
  shortcuts: {
    showHide: string;
    newSession: string;
    nextSession: string;
    prevSession: string;
  };
}
```

**Storage**: Uses `electron-store` for persistent JSON storage at:
- macOS: `~/Library/Application Support/termiNar/config.json`
- Windows: `%APPDATA%/termiNar/config.json`
- Linux: `~/.config/termiNar/config.json`

#### 5.1.4 ShortcutManager

```typescript
// src/main/ShortcutManager.ts
interface ShortcutManager {
  register(accelerator: string, action: () => void): void;
  unregister(accelerator: string): void;
  unregisterAll(): void;
  reloadFromConfig(): void;
}
```

**Responsibilities**:
- Register global keyboard shortcuts
- Handle shortcut conflicts gracefully
- Update shortcuts when config changes

#### 5.1.5 AutoUpdater

```typescript
// src/main/AutoUpdater.ts
interface AutoUpdater {
  checkForUpdates(): Promise<UpdateInfo | null>;
  downloadUpdate(): Promise<void>;
  installUpdate(): void;
  onUpdateAvailable(callback: (info: UpdateInfo) => void): void;
}
```

**Implementation**: Uses `electron-updater` with GitHub Releases.

### 5.2 Preload Script

```typescript
// src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),

  // Config
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (key: string, value: any) => ipcRenderer.invoke('config:set', key, value),

  // Notifications
  showNotification: (title: string, body: string) =>
    ipcRenderer.send('notification:show', { title, body }),

  // Sessions (IPC to main for tray updates)
  onSessionsChanged: (callback: (sessions: SessionInfo[]) => void) => {
    ipcRenderer.on('sessions:changed', (_, sessions) => callback(sessions));
  },
  notifySessionsChanged: (sessions: SessionInfo[]) =>
    ipcRenderer.send('sessions:changed', sessions),

  // Platform info
  platform: process.platform,

  // App info
  getVersion: () => ipcRenderer.invoke('app:version'),
});
```

### 5.3 Renderer Integration

The renderer loads the existing Svelte web client with minor modifications:

```typescript
// src/renderer/main.ts
import App from '../../../web/src/App.svelte';

// Extend WebSocketSessionManager to notify main process
const originalConnect = WebSocketSessionManager.prototype.connect;
WebSocketSessionManager.prototype.connect = async function() {
  await originalConnect.call(this);

  // Notify main process of session changes
  this.on('sessionList', (sessions) => {
    window.electronAPI?.notifySessionsChanged(sessions);
  });
};

const app = new App({
  target: document.getElementById('app')!,
});
```

### 5.4 IPC Messages

| Channel | Direction | Payload | Description |
|---------|-----------|---------|-------------|
| `window:minimize` | Renderer → Main | - | Minimize window |
| `window:maximize` | Renderer → Main | - | Toggle maximize |
| `window:close` | Renderer → Main | - | Close/minimize to tray |
| `config:get` | Renderer → Main | - | Get full config |
| `config:set` | Renderer → Main | `{ key, value }` | Set config value |
| `notification:show` | Renderer → Main | `{ title, body }` | Show notification |
| `sessions:changed` | Renderer → Main | `SessionInfo[]` | Update tray menu |
| `sessions:changed` | Main → Renderer | `SessionInfo[]` | Session list update |
| `shortcut:triggered` | Main → Renderer | `string` | Global shortcut |
| `app:version` | Renderer → Main | - | Get app version |

---

## 6. Security

### 6.1 Context Isolation

```javascript
// main.ts
const mainWindow = new BrowserWindow({
  webPreferences: {
    contextIsolation: true,      // Required
    nodeIntegration: false,       // Required
    sandbox: true,                // Enhanced security
    preload: path.join(__dirname, 'preload.js'),
  },
});
```

### 6.2 Content Security Policy

```html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'self';
  script-src 'self';
  style-src 'self' 'unsafe-inline';
  connect-src 'self' ws://localhost:* wss://*;
  img-src 'self' data:;
  font-src 'self';
">
```

### 6.3 Token Storage

| Platform | Storage Method |
|----------|---------------|
| macOS | Keychain via `keytar` |
| Windows | Credential Manager via `keytar` |
| Linux | libsecret via `keytar` |

```typescript
// src/main/TokenStore.ts
import keytar from 'keytar';

const SERVICE_NAME = 'PersistentShell';

export async function saveToken(server: string, token: string): Promise<void> {
  await keytar.setPassword(SERVICE_NAME, server, token);
}

export async function getToken(server: string): Promise<string | null> {
  return keytar.getPassword(SERVICE_NAME, server);
}

export async function deleteToken(server: string): Promise<boolean> {
  return keytar.deletePassword(SERVICE_NAME, server);
}
```

---

## 7. Configuration

### 7.1 Default Configuration

```json
{
  "window": {
    "width": 1200,
    "height": 800,
    "x": null,
    "y": null,
    "maximized": false
  },
  "general": {
    "startAtLogin": false,
    "minimizeToTray": true,
    "showTrayIcon": true,
    "alwaysOnTop": false
  },
  "terminal": {
    "fontFamily": "Menlo, Monaco, 'Courier New', monospace",
    "fontSize": 14,
    "theme": "dark",
    "scrollback": 10000
  },
  "connection": {
    "defaultServer": "ws://localhost:3000",
    "autoReconnect": true,
    "reconnectDelay": 5,
    "savedServers": []
  },
  "shortcuts": {
    "showHide": "CommandOrControl+Shift+T",
    "newSession": "CommandOrControl+Shift+N",
    "nextSession": "CommandOrControl+Tab",
    "prevSession": "CommandOrControl+Shift+Tab"
  }
}
```

### 7.2 Command Line Arguments

| Argument | Description |
|----------|-------------|
| `--server=URL` | Connect to specific server on startup |
| `--hidden` | Start minimized to tray |
| `--debug` | Enable DevTools |
| `--disable-gpu` | Disable GPU acceleration |

---

## 8. Build & Distribution

### 8.1 Build Tools

| Tool | Purpose |
|------|---------|
| `electron-builder` | Package and distribute |
| `electron-forge` | Alternative (if preferred) |
| `vite` | Bundle renderer process |
| `esbuild` | Bundle main/preload |

### 8.2 Build Targets

| Platform | Format | Architecture |
|----------|--------|--------------|
| macOS | DMG, ZIP | x64, arm64 (Universal) |
| Windows | NSIS, portable | x64 |
| Linux | AppImage, deb, rpm | x64 |

### 8.3 Code Signing

| Platform | Requirement |
|----------|-------------|
| macOS | Apple Developer ID (required for notarization) |
| Windows | EV Code Signing Certificate (recommended) |
| Linux | GPG signing (optional) |

### 8.4 Auto-Update

```yaml
# electron-builder.yml
publish:
  provider: github
  owner: narailabs
  repo: narai
  releaseType: release
```

Update flow:
1. Check for updates on startup (configurable)
2. Download update in background
3. Prompt user to restart and update
4. Apply update on next launch

---

## 9. Testing Strategy

### 9.1 Unit Tests

| Module | Test Framework | Coverage Target |
|--------|----------------|-----------------|
| ConfigStore | Vitest | 90% |
| WindowManager | Vitest + mock | 80% |
| TrayManager | Vitest + mock | 80% |
| ShortcutManager | Vitest + mock | 80% |

### 9.2 Integration Tests

| Test | Framework | Description |
|------|-----------|-------------|
| IPC communication | Playwright | Test preload ↔ main |
| Window lifecycle | Playwright | Open, close, minimize |
| Config persistence | Playwright | Save and restore |

### 9.3 E2E Tests

| Test | Framework | Description |
|------|-----------|-------------|
| Full connection flow | Playwright | Connect, create session, type |
| Tray interactions | Spectron/Playwright | Tray menu actions |
| Settings persistence | Playwright | Change settings, restart |

### 9.4 Test Commands

```bash
# Unit tests
pnpm test

# Integration tests
pnpm test:integration

# E2E tests (requires running server)
pnpm test:e2e

# All tests
pnpm test:all
```

---

## 10. File Structure

```
apps/terminar/electron/
├── SPEC-ELECTRON.md          # This specification
├── package.json              # Electron app package
├── tsconfig.json             # TypeScript config
├── electron-builder.yml      # Build configuration
├── vite.config.ts            # Vite config for renderer
├── src/
│   ├── main/                 # Main process
│   │   ├── index.ts          # Entry point
│   │   ├── WindowManager.ts  # Window management
│   │   ├── TrayManager.ts    # System tray
│   │   ├── ConfigStore.ts    # Configuration
│   │   ├── ShortcutManager.ts # Global shortcuts
│   │   ├── TokenStore.ts     # Secure token storage
│   │   ├── AutoUpdater.ts    # Auto-update logic
│   │   └── ipc.ts            # IPC handlers
│   ├── preload/              # Preload scripts
│   │   └── index.ts          # Context bridge
│   └── renderer/             # Renderer process
│       ├── index.html        # HTML entry
│       └── main.ts           # Renderer entry (loads Svelte)
├── resources/                # App resources
│   ├── icon.icns             # macOS icon
│   ├── icon.ico              # Windows icon
│   ├── icon.png              # Linux icon
│   └── tray-icon.png         # Tray icon (16x16, 32x32)
└── tests/
    ├── unit/                 # Unit tests
    ├── integration/          # Integration tests
    └── e2e/                  # End-to-end tests
```

---

## 11. Dependencies

### 11.1 Production Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `electron` | ^28.0.0 | Electron runtime |
| `electron-store` | ^8.0.0 | Persistent config storage |
| `electron-updater` | ^6.0.0 | Auto-update |
| `keytar` | ^7.0.0 | Secure credential storage |

### 11.2 Development Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `electron-builder` | ^24.0.0 | Build and package |
| `vite` | ^5.0.0 | Renderer bundler |
| `vite-plugin-electron` | ^0.28.0 | Electron Vite plugin |
| `vitest` | ^1.0.0 | Unit testing |
| `playwright` | ^1.40.0 | E2E testing |
| `typescript` | ^5.3.0 | TypeScript |

---

## 12. Implementation Phases

### Phase 1: Core Shell (MVP)

| Task | Priority | Estimate |
|------|----------|----------|
| Project setup (Vite + Electron) | P0 | - |
| Main process entry point | P0 | - |
| Window management | P0 | - |
| Preload script with IPC | P0 | - |
| Load Svelte web client | P0 | - |
| Basic menu bar | P1 | - |

### Phase 2: Desktop Integration

| Task | Priority | Estimate |
|------|----------|----------|
| System tray with session list | P0 | - |
| Minimize to tray | P0 | - |
| Global shortcuts | P1 | - |
| Native notifications | P1 | - |
| Auto-start configuration | P1 | - |

### Phase 3: Persistence & Polish

| Task | Priority | Estimate |
|------|----------|----------|
| Config store implementation | P0 | - |
| Window state persistence | P0 | - |
| Settings dialog | P1 | - |
| Secure token storage | P1 | - |
| Theme support | P2 | - |

### Phase 4: Distribution

| Task | Priority | Estimate |
|------|----------|----------|
| Build configuration | P0 | - |
| macOS notarization | P1 | - |
| Windows code signing | P1 | - |
| Auto-update implementation | P1 | - |
| Linux packages | P2 | - |

---

## 13. Success Criteria

| Criteria | Metric |
|----------|--------|
| Startup time | < 2 seconds to usable terminal |
| Memory usage | < 150MB idle |
| Connection time | < 500ms to local server |
| Reconnection | Automatic within 5 seconds |
| All tests pass | 100% green |
| Cross-platform | Works on macOS, Windows, Linux |
