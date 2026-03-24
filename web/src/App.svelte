<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import WorkspaceView from './components/WorkspaceView.svelte';

  import LoginPage from './components/LoginPage.svelte';
  import Sidebar from './components/Sidebar.svelte';
  import SettingsPanel from './components/SettingsPanel.svelte';
  import { WebSocketSessionManager } from './lib/WebSocketSessionManager';
  import type { ConnectionState, SessionManager } from './lib/SessionManager';
  import { LocalEchoManager } from './lib/LocalEchoManager';
  import { createManager as singletonCreate, destroyManager as singletonDestroy, isActiveManager } from './lib/connectionSingleton';
  import { settingsStore } from './lib/settingsStore.svelte';
  import { initializeSettings } from './lib/settingsApi';
  import { workspaceStore } from './lib/workspaceStore';
  import { applyUIThemeCSS, themeState, initAutoMode } from './lib/themeStore.svelte';
  import type { Workspace } from './lib/workspaceTypes';

  import AppToolbar from './components/AppToolbar.svelte';
  import BroadcastBar from './components/BroadcastBar.svelte';
  import { broadcastEnabled, clearTargets, setSessionManager } from './lib/broadcastStore.svelte';
  import { getEffectiveEnv } from './lib/envStore.svelte';
  import { getKeyBindingRegistry } from './lib/keybindings';
  import { activityStore } from './lib/activityStore.svelte';
  import { markExited } from './lib/exitedSessionsStore.svelte';
  import { foregroundStore } from './lib/foregroundStore.svelte';
  import { parseSshPrivateKey } from './lib/sshKeyParser';
  import { reactiveBox, setManagerContext, setSessionsContext, setActionsContext, type AppActions } from './lib/sessionContext.svelte';
  import { sessionCwdStore } from './lib/sessionCwdStore.svelte';

  // Check for local-echo mode via URL parameter or localStorage (for e2e tests)
  const isLocalEchoMode = typeof window !== 'undefined' && (
    new URLSearchParams(window.location.search).has('local-echo') ||
    (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function' && localStorage.getItem('local-echo') === '1')
  );

  // Connection management uses connectionSingleton.ts for deduplication.
  // That module is a plain .ts file with true module-level scope, unlike
  // Svelte 5 components where all <script> code is per-instance.

  interface SessionInfo {
    id: string;
    name: string;
    shell: string;
    cwd: string;
    started_at: string;
  }

  // Props for server URLs (allows testing with different URLs)
  let {
    serverHttpUrl = 'http://localhost:6750',
    serverWsUrl = 'ws://localhost:6750/ws',
  }: {
    serverHttpUrl?: string;
    serverWsUrl?: string;
  } = $props();

  let token = $state('');
  let pairingCode = $state('');
  let pairingError = $state('');
  let isPairingMode = $state(false);
  let isExchangingCode = $state(false);
  let isConnected = $state(false);
  let hasConnectedOnce = $state(false);  // Track if we've ever connected
  let serverRequiresAuth = $state(false);  // True when local server unexpectedly requires auth
  let authError = $state('');
  let isAuthenticating = $state(false);
  let manager = $state<SessionManager | null>(null);

  // Session state
  let sessions = $state<SessionInfo[]>([]);
  let sidebarOpen = $state(true);
  let pendingNewTerminal = $state(false);
  let pendingNewTerminalPaneId = $state<string | null>(null);

  // Context reactive boxes for child components
  const managerBox = reactiveBox<SessionManager | null>(null);
  const sessionsBox = reactiveBox<SessionInfo[]>([]);
  setManagerContext(managerBox);
  setSessionsContext(sessionsBox);

  // Keep boxes in sync with local state
  $effect(() => {
    managerBox.value = manager;
  });
  $effect(() => {
    sessionsBox.value = sessions;
  });

  // Actions context for child components (replaces event bubbling)
  const appActions: AppActions = {
    createNewTerminal,
    createNewTerminalWithCwd,
    closeTerminal,
    renameTerminal,
    toggleSidebar: () => { sidebarOpen = !sidebarOpen; },
    resetTerminal,
  };
  setActionsContext(appActions);

  // Settings panel state
  let showSettingsPanel = $state(false);

  // Broadcast bar state
  let showBroadcastBar = $state(false);

  function toggleBroadcast() {
    if (broadcastEnabled.value) {
      // Disabling broadcast mode: close bar and clear targets
      showBroadcastBar = false;
      broadcastEnabled.value = false;
      clearTargets();
    } else {
      // Enabling broadcast mode: open bar
      broadcastEnabled.value = true;
      showBroadcastBar = true;
    }
  }

  function closeBroadcastBar() {
    showBroadcastBar = false;
    // Keep broadcast mode enabled and targets intact
  }

  // Connection state tracking
  let connectionState = $state<ConnectionState>('disconnected');
  let reconnectAttempt = $state(0);
  let reconnectDelay = $state(0);

  // Detect if connecting to localhost (no auth needed)
  function isLocalServer(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.hostname === 'localhost' ||
             parsed.hostname === '127.0.0.1' ||
             parsed.hostname === '[::1]';
    } catch {
      return false;
    }
  }

  // Enforce WSS for remote connections to prevent credential interception
  function enforceSecureConnection(url: string): string {
    if (!isLocalServer(url)) {
      try {
        const parsed = new URL(url);
        if (parsed.protocol === 'ws:') {
          parsed.protocol = 'wss:';
          console.warn(`[Security] Upgrading remote connection to WSS: ${parsed.href}`);
          return parsed.href;
        }
      } catch {
        // If URL parsing fails, fall through to return original
      }
    }
    return url;
  }

  // Cookie-based auth helpers -- replaces localStorage token persistence.
  // After successful WebSocket auth, POST the token to /auth/session to set HttpOnly cookies.
  // The server sets Secure; HttpOnly; SameSite=Strict cookies that the browser sends
  // automatically on WebSocket upgrade requests, enabling transparent reconnection.
  let refreshInterval: ReturnType<typeof setInterval> | null = null;

  async function setSessionCookie(accessToken: string): Promise<void> {
    try {
      await fetch(`${serverHttpUrl}/auth/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token: accessToken }),
      });
      startTokenRefresh();
    } catch (err) {
      console.warn('[Auth] Failed to set session cookie:', err);
    }
  }

  async function clearSessionCookie(): Promise<void> {
    try {
      await fetch(`${serverHttpUrl}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch (err) {
      console.warn('[Auth] Failed to clear session cookie:', err);
    }
    stopTokenRefresh();
  }

  function startTokenRefresh(): void {
    stopTokenRefresh();
    // Refresh every 14 minutes (access token expires in 15 min)
    refreshInterval = setInterval(async () => {
      try {
        await fetch(`${serverHttpUrl}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
        });
      } catch (err) {
        console.warn('[Auth] Token refresh failed:', err);
      }
    }, 14 * 60 * 1000);
  }

  function stopTokenRefresh(): void {
    if (refreshInterval) {
      clearInterval(refreshInterval);
      refreshInterval = null;
    }
  }

  let isLocal = $derived(isLocalServer(serverWsUrl));

  // Apply UI theme CSS variables whenever the theme state changes
  $effect(() => {
    if (themeState.value) {
      applyUIThemeCSS();
    }
  });

  // Listen for OS color scheme changes when mode is 'auto'
  initAutoMode();

  // Global keyboard shortcuts -- delegates to the centralized KeyBindingRegistry
  function handleGlobalKeydown(event: KeyboardEvent) {
    // Skip if already handled by the terminal's custom key event handler
    if (event.defaultPrevented) return;

    const registry = getKeyBindingRegistry();
    const action = registry.match(event);
    if (!action) return;

    event.preventDefault();
    switch (action) {
      case 'sidebar.toggle':
        sidebarOpen = !sidebarOpen;
        break;
      case 'session.new':
        createNewTerminal();
        break;
    }
  }

  // Load workspace from server
  async function loadWorkspace(): Promise<Workspace | null> {
    try {
      const response = await fetch(`${serverHttpUrl}/workspace`);
      if (response.ok) {
        const data = await response.json();
        return data.workspace || null;
      }
    } catch (e) {
      console.warn('[App] Failed to load workspace from server:', e);
    }
    return null;
  }

  // Save workspace to server
  async function saveWorkspace(workspace: Workspace): Promise<void> {
    try {
      await fetch(`${serverHttpUrl}/workspace`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace, templates: [] }),
      });
    } catch (e) {
      console.error('[App] Failed to save workspace:', e);
    }
  }

  // Expose tab operations for Electron multi-window coordination.
  // The main process queries these via executeJavaScript('window.__terminar.getTabIds()').
  function exposeTerminarBridge() {
    (window as any).__terminar = {
      getTabIds: () => workspaceStore.get().tabs.map((t: { id: string }) => t.id),
      createTab: () => workspaceStore.createTab(),
    };
  }

  // Auto-connect on mount if local
  onMount(async () => {
    // Expose the multi-window bridge immediately so it's ready when the
    // main process queries it (the bridge reads from workspaceStore which
    // is always available as a module singleton).
    exposeTerminarBridge();

    // Check for local-echo mode (bypasses server completely)
    if (isLocalEchoMode) {
      console.log('[App] Local Echo Mode - bypassing server for testing');
      connectLocalEcho();
      window.addEventListener('keydown', handleGlobalKeydown);
      return;
    }

    // Initialize settings from server (with localStorage fallback)
    await initializeSettings(settingsStore, serverHttpUrl);

    if (isLocal) {
      connectLocal();
    } else {
      // Try cookie-based auto-reconnection for remote servers.
      // HttpOnly cookies are sent automatically on the WebSocket upgrade request,
      // so we attempt a direct connection. If the cookie is valid, the server
      // authenticates without message-based auth. If not, the login page is shown.
      // Fire-and-forget: runs in background so UI is immediately interactive.
      connectWithCookie();
    }
    window.addEventListener('keydown', handleGlobalKeydown);
  });

  onDestroy(() => {
    window.removeEventListener('keydown', handleGlobalKeydown);
    stopTokenRefresh();
    // Clean up via singleton (ensures only current active manager is affected)
    singletonDestroy();
    manager = null;
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      if (isPairingMode) {
        exchangeCode();
      } else {
        connect();
      }
    }
  }

  function togglePairingMode() {
    isPairingMode = !isPairingMode;
    pairingError = '';
    pairingCode = '';
  }

  // Connect in local-echo mode (no server, for testing xterm.js)
  async function connectLocalEcho() {
    console.log('[App] Starting in local-echo mode (bypassing server)');
    manager = new LocalEchoManager();

    setupManagerEvents();

    connectionState = 'connecting';
    try {
      await manager.connect();
      console.log('[App] Local echo mode ready');
      isConnected = true;
      connectionState = 'connected';

      // Initialize empty workspace (no server)
      workspaceStore.initialize(null);
    } catch (err) {
      console.error('[App] Local echo mode failed:', err);
      isConnected = false;
      connectionState = 'disconnected';
    }
  }

  // Connect without authentication (for local connections)
  async function connectLocal() {
    console.log('[App] Auto-connecting to local server (no auth required)');
    // Capture raw reference before assigning to $state (Svelte 5 may wrap
    // plain objects in a reactive proxy, breaking strict-equality checks).
    const mgr = singletonCreate(serverWsUrl);
    manager = mgr;

    setupManagerEvents();

    connectionState = 'connecting';
    try {
      await mgr.connect();
      // After async connect, verify this manager is still the active singleton.
      // If another mount replaced it while we were connecting, bail out.
      if (!isActiveManager(mgr)) {
        console.log('[App] Connection superseded by newer mount, skipping');
        return;
      }
      console.log('[App] Connected to local server');
      isConnected = true;
      connectionState = 'connected';
      mgr.listSessions();

      // Initialize workspace
      const serverWorkspace = await loadWorkspace();
      workspaceStore.initialize(serverWorkspace);
      workspaceStore.setSaveCallback(saveWorkspace);
    } catch (err) {
      console.error('[App] Local connection failed:', err);
      isConnected = false;
      connectionState = 'disconnected';
    }
  }

  // Setup event handlers for the manager
  function setupManagerEvents() {
    if (!manager) return;

    // Remove all existing listeners to prevent accumulation during HMR or reconnection
    manager.removeAllListeners();

    manager.on('stateChange', (state: ConnectionState) => {
      connectionState = state;
      if (state === 'connected') {
        isConnected = true;
        hasConnectedOnce = true;
      } else if (state === 'disconnected' && !hasConnectedOnce) {
        // Only show LoginPage if we've never successfully connected.
        // During reconnection cycles, keep the workspace visible so
        // terminals aren't destroyed — the toolbar shows reconnection status.
        isConnected = false;
      }
      // For 'reconnecting' and 'connecting' after first connection, keep isConnected = true
    });

    manager.on('reconnecting', (attempt: number, delay: number) => {
      reconnectAttempt = attempt;
      reconnectDelay = delay;
      console.log(`Reconnecting in ${delay}ms (attempt ${attempt})`);
    });

    manager.on('reconnected', () => {
      console.log('Reconnected successfully!');
      reconnectAttempt = 0;
      reconnectDelay = 0;
    });

    manager.on('sessionList', (newSessions: SessionInfo[]) => {
      console.log('Sessions:', newSessions);
      const previousSessionIds = new Set(sessions.map(s => s.id));
      const isFirstSessionList = previousSessionIds.size === 0;
      sessions = newSessions;

      // Initialize foreground store from session list data
      for (const s of newSessions) {
        if ((s as any).foreground_process) {
          foregroundStore.setForeground(s.id, (s as any).foreground_process);
        }
      }

      // Clear workspace panes that reference sessions no longer on the server
      const currentSessionIds = new Set(newSessions.map(s => s.id));
      workspaceStore.clearStaleSessions(currentSessionIds);

      // Helper to find first empty pane
      function findEmptyPane(node: any): string | null {
        if (node.type === 'pane') {
          return node.sessionId === null ? node.id : null;
        }
        for (const child of node.children) {
          const found = findEmptyPane(child);
          if (found) return found;
        }
        return null;
      }

      // If no sessions, create one
      if (sessions.length === 0) {
        createNewTerminal();
      } else if (isFirstSessionList && sessions.length > 0) {
        // First session list - auto-assign first session to empty pane
        const ws = workspaceStore.get();
        const tab = ws.tabs.find(t => t.id === ws.activeTabId);
        if (tab) {
          const emptyPaneId = findEmptyPane(tab.root);
          if (emptyPaneId) {
            workspaceStore.assignSession(emptyPaneId, sessions[0].id);
          }
        }
      } else if (pendingNewTerminal) {
        // Find and select the newly created terminal
        const newSession = sessions.find(s => !previousSessionIds.has(s.id));
        if (newSession) {
          // Mark as new so the "(new)" badge shows until first input
          workspaceStore.markSessionNew(newSession.id);
          if (pendingNewTerminalPaneId) {
            // Assign to the specific pane that requested the new terminal
            workspaceStore.assignSession(pendingNewTerminalPaneId, newSession.id);
          } else {
            // Auto-assign to first empty pane if exists
            const ws = workspaceStore.get();
            const tab = ws.tabs.find(t => t.id === ws.activeTabId);
            if (tab) {
              const emptyPaneId = findEmptyPane(tab.root);
              if (emptyPaneId) {
                workspaceStore.assignSession(emptyPaneId, newSession.id);
              }
            }
          }
        }
        pendingNewTerminal = false;
        pendingNewTerminalPaneId = null;
      }
    });

    manager.on('sessionActivity', (sessionId: string, activityType: string) => {
      activityStore.setActivity(sessionId, activityType as any);
    });

    manager.on('sessionExited', (sessionId: string, exitCode: number) => {
      markExited(sessionId, exitCode);
    });

    manager.on('foregroundChanged', (sessionId: string, processName: string | null) => {
      foregroundStore.setForeground(sessionId, processName);
    });

    manager.on('cwdChanged', (sessionId: string, cwd: string) => {
      sessionCwdStore.set(sessionId, cwd);
      sessions = sessions.map(s => s.id === sessionId ? { ...s, cwd } : s);
    });

    manager.on('shutdown', (reason: string) => {
      console.log('Server shutting down:', reason);
    });

    manager.on('error', (err: Error) => {
      console.error('WebSocket error:', err);

      // Detect auth-related errors from the server (e.g. when the gateway
      // requires authentication but connectLocal() skipped auth).  In that
      // case, stop the reconnect loop and fall back to the login page so the
      // user can provide credentials.
      const isAuthError = /auth|Expected Auth|authentication/i.test(err.message);
      if (isAuthError && isLocal) {
        console.warn('[App] Local server requires authentication — showing login page');
        // Stop reconnection (same auth-less attempt would fail again)
        manager?.disconnect();
        singletonDestroy();
        manager = null;
        hasConnectedOnce = false;
        isConnected = false;
        connectionState = 'disconnected';
        // Switch LoginPage to auth mode so the login form is shown
        // instead of the "Retry Connection" button.
        serverRequiresAuth = true;
        authError = 'Server requires authentication. Please sign in.';
        return;
      }

      if (connectionState === 'disconnected') {
        alert(`Connection error: ${err.message}`);
      }
    });
  }

  async function exchangeCode() {
    if (!pairingCode || pairingCode.length < 6) {
      pairingError = 'Please enter a valid pairing code';
      return;
    }

    pairingError = '';
    isExchangingCode = true;

    try {
      const response = await fetch(`${serverHttpUrl}/pair/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: pairingCode })
      });

      if (response.status === 429) {
        pairingError = 'Too many attempts. Please wait and try again.';
        return;
      }

      if (!response.ok) {
        pairingError = 'Invalid or expired pairing code';
        return;
      }

      const data = await response.json();
      if (data.token) {
        token = data.token;
        isPairingMode = false;
        pairingCode = '';
        connect();
      } else {
        pairingError = 'Unexpected response from server';
      }
    } catch (err) {
      console.error('Pairing exchange failed:', err);
      pairingError = 'Failed to connect to server';
    } finally {
      isExchangingCode = false;
    }
  }

  function handleReconnect() {
    manager?.reconnect();
  }

  // Connect with authentication (for remote connections)
  async function connect() {
    if (!token) return;

    console.log('[App] Connecting to remote server with token');
    const wsUrl = enforceSecureConnection(serverWsUrl);
    manager = singletonCreate(wsUrl, token);

    setupManagerEvents();

    try {
      await manager.connect();
      console.log('[App] Connected to remote server');
      isConnected = true;
      connectionState = 'connected';
      manager?.listSessions();

      // Set HttpOnly cookies for automatic reconnection on page refresh
      setSessionCookie(token);

      // Initialize workspace
      const serverWorkspace = await loadWorkspace();
      workspaceStore.initialize(serverWorkspace);
      workspaceStore.setSaveCallback(saveWorkspace);
    } catch (err) {
      console.error('[App] Remote connection failed:', err);
      isConnected = false;
      connectionState = 'disconnected';
      // Clear any stale session cookie on connection failure
      clearSessionCookie();
      alert('Connection failed. Check console and token.');
    }
  }

  // Cookie-based reconnection: the browser sends HttpOnly cookies automatically
  // on the WebSocket upgrade request. The server validates the cookie and sends AuthOk.
  // This runs silently (no isAuthenticating UI state) -- if it fails, the login page shows.
  async function connectWithCookie(): Promise<boolean> {
    const wsUrl = enforceSecureConnection(serverWsUrl);
    const wsManager = singletonCreate(wsUrl);

    // Set manager and wire up events BEFORE connecting, so events emitted
    // during auth are not missed (matches connectLocal/connectWithPassword pattern).
    manager = wsManager;
    setupManagerEvents();

    try {
      const authPromise = new Promise<void>((resolve, reject) => {
        wsManager.on('authenticated', () => resolve());
        wsManager.on('error', (err: Error) => reject(err));
      });

      await wsManager.connect();
      // No auth message needed -- the cookie is sent with the upgrade request

      await Promise.race([
        authPromise,
        new Promise<void>((_, reject) => setTimeout(() => reject(new Error('Cookie auth timeout')), 5000)),
      ]);

      // Cookie auth succeeded
      isConnected = true;
      connectionState = 'connected';
      startTokenRefresh();

      manager?.listSessions();
      const serverWorkspace = await loadWorkspace();
      workspaceStore.initialize(serverWorkspace);
      workspaceStore.setSaveCallback(saveWorkspace);
      return true;
    } catch {
      // Cookie auth failed -- clean up
      singletonDestroy();
      manager = null;
      return false;
    }
  }

  // JWT token reconnection (for saved tokens)
  async function connectWithJwtToken(jwtToken: string) {
    authError = '';
    isAuthenticating = true;

    try {
      const wsUrl = enforceSecureConnection(serverWsUrl);
      manager = singletonCreate(wsUrl);
      setupManagerEvents();

      const authPromise = new Promise<void>((resolve, reject) => {
        manager!.on('authenticated', () => {
          isConnected = true;
          connectionState = 'connected';
          resolve();
        });
        manager!.on('error', (err: Error) => {
          reject(err);
        });
      });

      await manager.connect();
      (manager as WebSocketSessionManager).authenticateWithToken(jwtToken);

      await Promise.race([
        authPromise,
        new Promise<void>((_, reject) => setTimeout(() => reject(new Error('Token expired')), 10000)),
      ]);

      manager?.listSessions();
      const serverWorkspace = await loadWorkspace();
      workspaceStore.initialize(serverWorkspace);
      workspaceStore.setSaveCallback(saveWorkspace);
    } catch (err: any) {
      console.warn('[App] JWT reconnection failed, showing login:', err?.message);
      clearSessionCookie();
      token = '';
      isConnected = false;
      connectionState = 'disconnected';
      singletonDestroy();
      manager = null;
    } finally {
      isAuthenticating = false;
    }
  }

  // Password authentication for remote connections
  async function connectWithPassword(username: string, password: string, rememberMe: boolean) {
    authError = '';
    isAuthenticating = true;

    try {
      const wsUrl = enforceSecureConnection(serverWsUrl);
      manager = singletonCreate(wsUrl);
      setupManagerEvents();

      // Listen for auth result
      const authPromise = new Promise<void>((resolve, reject) => {
        manager!.on('authenticated', (jwtToken: string) => {
          isConnected = true;
          connectionState = 'connected';
          if (rememberMe) {
            setSessionCookie(jwtToken);
          }
          resolve();
        });
        manager!.on('error', (err: Error) => {
          reject(err);
        });
      });

      await manager.connect();
      // Send password auth after connection
      (manager as WebSocketSessionManager).authenticateWithPassword(username, password);

      await Promise.race([
        authPromise,
        new Promise<void>((_, reject) => setTimeout(() => reject(new Error('Authentication timeout')), 15000)),
      ]);

      manager?.listSessions();
      const serverWorkspace = await loadWorkspace();
      workspaceStore.initialize(serverWorkspace);
      workspaceStore.setSaveCallback(saveWorkspace);
    } catch (err: any) {
      console.error('[App] Password auth failed:', err);
      authError = err?.message || 'Authentication failed';
      isConnected = false;
      connectionState = 'disconnected';
      singletonDestroy();
      manager = null;
    } finally {
      isAuthenticating = false;
    }
  }

  // SSH key authentication for remote connections
  async function connectWithSshKey(username: string, privateKeyPem: string, rememberMe: boolean) {
    authError = '';
    isAuthenticating = true;

    try {
      // Parse the private key to extract public key and algorithm
      const { publicKeyStr, algorithm, signFn } = await parseSshPrivateKey(privateKeyPem);

      const wsUrl = enforceSecureConnection(serverWsUrl);
      manager = singletonCreate(wsUrl);
      setupManagerEvents();

      const authPromise = new Promise<void>((resolve, reject) => {
        manager!.on('authenticated', (jwtToken: string) => {
          isConnected = true;
          connectionState = 'connected';
          if (rememberMe) {
            setSessionCookie(jwtToken);
          }
          resolve();
        });
        manager!.on('error', (err: Error) => {
          reject(err);
        });
      });

      await manager.connect();
      (manager as WebSocketSessionManager).authenticateWithPubkey(
        username, publicKeyStr, algorithm, signFn,
      );

      await Promise.race([
        authPromise,
        new Promise<void>((_, reject) => setTimeout(() => reject(new Error('Authentication timeout')), 15000)),
      ]);

      manager?.listSessions();
      const serverWorkspace = await loadWorkspace();
      workspaceStore.initialize(serverWorkspace);
      workspaceStore.setSaveCallback(saveWorkspace);
    } catch (err: any) {
      console.error('[App] SSH key auth failed:', err);
      authError = err?.message || 'SSH key authentication failed';
      isConnected = false;
      connectionState = 'disconnected';
      singletonDestroy();
      manager = null;
    } finally {
      isAuthenticating = false;
    }
  }

  // Handle login events from LoginPage component
  function handlePasswordAuth(detail: { username: string; password: string; rememberMe: boolean }) {
    connectWithPassword(detail.username, detail.password, detail.rememberMe);
  }

  function handleSshKeyAuth(detail: { username: string; privateKeyPem: string; rememberMe: boolean }) {
    connectWithSshKey(detail.username, detail.privateKeyPem, detail.rememberMe);
  }

  function handleTokenAuth(detail: { token: string }) {
    token = detail.token;
    connect();
  }

  function handlePairingAuth(detail: { code: string }) {
    pairingCode = detail.code;
    exchangeCode();
  }

  function handleRetryLocal() {
    serverRequiresAuth = false;
    authError = '';
    connectLocal();
  }

  // Logout: disconnect and clear token
  function logout() {
    singletonDestroy();
    manager = null;
    isConnected = false;
    hasConnectedOnce = false;
    serverRequiresAuth = false;
    connectionState = 'disconnected';
    clearSessionCookie();
    token = '';
    sessions = [];
    authError = '';
  }

  // Terminal management functions
  function createNewTerminal(targetPaneId?: string) {
    pendingNewTerminal = true;
    pendingNewTerminalPaneId = targetPaneId || null;
    // Estimate terminal dimensions from viewport to avoid hardcoded 80x24.
    // This ensures the PTY spawns at roughly the right size, preventing garbled
    // output when apps (like Claude Code) render before a resize event arrives.
    // Character cell size ~8px wide, ~17px tall is a reasonable estimate for
    // default monospace fonts. The terminal will send precise resize after attach.
    const estimatedCols = Math.max(40, Math.floor((window.innerWidth * 0.75) / 8));
    const estimatedRows = Math.max(10, Math.floor((window.innerHeight * 0.85) / 17));
    const envVars = getEffectiveEnv({});
    manager?.createSession('', '', envVars, estimatedCols, estimatedRows);
  }

  function createNewTerminalWithCwd(targetPaneId: string, cwd: string) {
    pendingNewTerminal = true;
    pendingNewTerminalPaneId = targetPaneId;
    const estimatedCols = Math.max(40, Math.floor((window.innerWidth * 0.75) / 8));
    const estimatedRows = Math.max(10, Math.floor((window.innerHeight * 0.85) / 17));
    const envVars = getEffectiveEnv({});
    manager?.createSession(cwd, '', envVars, estimatedCols, estimatedRows);
  }

  function closeTerminal(sessionId: string) {
    manager?.killSession(sessionId);
  }

  function renameTerminal(sessionId: string, newName: string) {
    manager?.renameSession(sessionId, newName);
  }

  function resetTerminal(sessionId: string, paneId: string) {
    const session = sessions.find(s => s.id === sessionId);
    const cwd = session?.cwd || '';
    const shell = session?.shell || '';
    manager?.killSession(sessionId);
    pendingNewTerminal = true;
    pendingNewTerminalPaneId = paneId;
    const estimatedCols = Math.max(40, Math.floor((window.innerWidth * 0.75) / 8));
    const estimatedRows = Math.max(10, Math.floor((window.innerHeight * 0.85) / 17));
    const envVars = getEffectiveEnv({});
    manager?.createSession(cwd, shell, envVars, estimatedCols, estimatedRows);
  }

  // Sidebar event handlers
  function handleSidebarToggle() {
    sidebarOpen = !sidebarOpen;
  }

  function handleSidebarSelect(sessionId: string) {
    // When clicking a session in sidebar, assign it to active pane
    const ws = workspaceStore.get();
    const tab = ws.tabs.find(t => t.id === ws.activeTabId);
    if (tab) {
      // Find first pane (simple approach - could be enhanced to track active pane)
      function findFirstPane(node: any): string | null {
        if (node.type === 'pane') return node.id;
        for (const child of node.children) {
          const found = findFirstPane(child);
          if (found) return found;
        }
        return null;
      }
      const paneId = findFirstPane(tab.root);
      if (paneId) {
        workspaceStore.assignSession(paneId, sessionId);
      }
    }
  }

  function handleSidebarClose(sessionId: string) {
    closeTerminal(sessionId);
  }

  function handleSidebarRename(detail: { id: string; newName: string }) {
    renameTerminal(detail.id, detail.newName);
  }

  function handleSidebarCreate() {
    createNewTerminal();
  }

  // Settings panel handlers
  function openSettings() {
    showSettingsPanel = true;
  }

  function closeSettings() {
    showSettingsPanel = false;
  }

  function handleSidebarPaneDrop(detail: { sourcePaneId: string }) {
    workspaceStore.detachPane(detail.sourcePaneId);
  }

  // Keep broadcast store's session manager in sync
  $effect(() => {
    setSessionManager(manager);
  });


</script>

<main>
  {#if !isConnected}
    <LoginPage
      isLocal={isLocal && !serverRequiresAuth}
      {connectionState}
      {authError}
      {isAuthenticating}
      onpasswordauth={(detail) => handlePasswordAuth(detail)}
      onsshkeyauth={(detail) => handleSshKeyAuth(detail)}
      ontokenauth={(detail) => handleTokenAuth(detail)}
      onpairingauth={(detail) => handlePairingAuth(detail)}
      onretrylocal={() => handleRetryLocal()}
    />
  {:else}
    <div class="app-container">
      <div class="main-area">
        <AppToolbar
          {connectionState}
          {reconnectAttempt}
          {reconnectDelay}
          {isLocalEchoMode}
          {isLocal}
          onReconnect={handleReconnect}
          onLogout={logout}
          onSettings={openSettings}
          onToggleBroadcast={toggleBroadcast}
        />
        <div class="workspace-area">
          <WorkspaceView />
        </div>
        {#if showBroadcastBar}
          <BroadcastBar onClose={closeBroadcastBar} />
        {/if}
      </div>
      <Sidebar
        {sessions}
        activeSessionId={null}
        isOpen={sidebarOpen}
        broadcastMode={broadcastEnabled.value}
        ontoggle={() => handleSidebarToggle()}
        onselect={(sessionId) => handleSidebarSelect(sessionId)}
        onclose={(sessionId) => handleSidebarClose(sessionId)}
        onrename={(detail) => handleSidebarRename(detail)}
        oncreate={() => handleSidebarCreate()}
        onsettings={() => openSettings()}
        onpanedrop={(detail) => handleSidebarPaneDrop(detail)}
      />
    </div>
  {/if}

  <!-- Settings Panel Modal -->
  <SettingsPanel isOpen={showSettingsPanel} onclose={() => closeSettings()} />
</main>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    overflow: hidden;
    background: var(--ui-bg-primary, #1e1e1e);
    color: var(--ui-text-primary, #cccccc);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }

  main {
    width: 100vw;
    height: 100vh;
  }

  .app-container {
    display: flex;
    height: 100%;
  }

  .main-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .workspace-area {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .input {
    padding: 10px;
    width: 300px;
    background: var(--ui-bg-tertiary, #3c3c3c);
    border: 1px solid var(--ui-border, #555);
    border-radius: 4px;
    color: var(--ui-text-primary, white);
    font-size: 14px;
  }

  .input:focus {
    outline: none;
    border-color: var(--ui-accent, #0e639c);
  }

  .btn {
    padding: 10px 20px;
    margin-left: 10px;
    background: var(--ui-accent, #0e639c);
    border: none;
    border-radius: 4px;
    color: white;
    cursor: pointer;
    font-size: 14px;
  }

  .btn:hover {
    background: var(--ui-accent-hover, #1177bb);
  }

  .btn:disabled {
    background: var(--ui-bg-tertiary, #555);
    cursor: not-allowed;
  }

  .btn-secondary {
    padding: 8px 16px;
    margin-left: 10px;
    background: var(--ui-bg-tertiary, #3c3c3c);
    border: 1px solid var(--ui-border, #555);
    border-radius: 4px;
    color: var(--ui-text-primary, white);
    cursor: pointer;
  }

  .btn-secondary:hover {
    background: var(--ui-bg-hover, #4a4a4a);
  }

  .spinner {
    width: 20px;
    height: 20px;
    border: 2px solid #333;
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

</style>
