<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import WorkspaceView from './components/WorkspaceView.svelte';
  import StatusBar from './components/StatusBar.svelte';
  import LoginPage from './components/LoginPage.svelte';
  import Sidebar from './components/Sidebar.svelte';
  import SettingsPanel from './components/SettingsPanel.svelte';
  import { WebSocketSessionManager } from './lib/WebSocketSessionManager';
  import type { ConnectionState, SessionManager } from './lib/SessionManager';
  import { LocalEchoManager } from './lib/LocalEchoManager';
  import { settingsStore } from './lib/settingsStore';
  import { initializeSettings } from './lib/settingsApi';
  import { workspaceStore } from './lib/workspaceStore';
  import { applyUIThemeCSS, themeState } from './lib/themeStore';
  import type { Workspace } from './lib/workspaceTypes';
  import { saveToken, loadToken, clearToken } from './lib/tokenStore';
  import AppToolbar from './components/AppToolbar.svelte';
  import BroadcastBar from './components/BroadcastBar.svelte';
  import { broadcastEnabled, clearTargets, setSessionManager } from './lib/broadcastStore';
  import { getEffectiveEnv } from './lib/envStore';
  import { getKeyBindingRegistry } from './lib/keybindings';
  import { activityStore } from './lib/activityStore';
  import { markExited, removeExited } from './lib/exitedSessionsStore';
  import { foregroundStore } from './lib/foregroundStore';
  import { parseSshPrivateKey } from './lib/sshKeyParser';
  import { writable } from 'svelte/store';
  import { setManagerContext, setSessionsContext, setActionsContext, type AppActions } from './lib/sessionContext';

  // Check for local-echo mode via URL parameter or localStorage (for e2e tests)
  const isLocalEchoMode = typeof window !== 'undefined' && (
    new URLSearchParams(window.location.search).has('local-echo') ||
    (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function' && localStorage.getItem('local-echo') === '1')
  );

  interface SessionInfo {
    id: string;
    name: string;
    shell: string;
    cwd: string;
    started_at: string;
  }

  // Props for server URLs (allows testing with different URLs)
  export let serverHttpUrl = 'http://localhost:3000';
  export let serverWsUrl = 'ws://localhost:3000/ws';

  let token = '';
  let pairingCode = '';
  let pairingError = '';
  let isPairingMode = false;
  let isExchangingCode = false;
  let isConnected = false;
  let authError = '';
  let isAuthenticating = false;
  let manager: SessionManager | null = null;

  // Session state
  let sessions: SessionInfo[] = [];
  let sidebarOpen = true;
  let pendingNewTerminal = false;

  // Context stores for child components
  const managerStore = writable<SessionManager | null>(null);
  const sessionsStore = writable<SessionInfo[]>([]);
  setManagerContext(managerStore);
  setSessionsContext(sessionsStore);

  // Keep stores in sync with local state
  $: managerStore.set(manager);
  $: sessionsStore.set(sessions);

  // Actions context for child components (replaces event bubbling)
  const appActions: AppActions = {
    createNewTerminal,
    closeTerminal,
    renameTerminal,
    toggleSidebar: () => { sidebarOpen = !sidebarOpen; },
  };
  setActionsContext(appActions);

  // Settings panel state
  let showSettingsPanel = false;

  // Broadcast bar state
  let showBroadcastBar = false;

  function toggleBroadcast() {
    if ($broadcastEnabled) {
      // Disabling broadcast mode: close bar and clear targets
      showBroadcastBar = false;
      broadcastEnabled.set(false);
      clearTargets();
    } else {
      // Enabling broadcast mode: open bar
      broadcastEnabled.set(true);
      showBroadcastBar = true;
    }
  }

  function closeBroadcastBar() {
    showBroadcastBar = false;
    // Keep broadcast mode enabled and targets intact
  }

  // Connection state tracking
  let connectionState: ConnectionState = 'disconnected';
  let reconnectAttempt = 0;
  let reconnectDelay = 0;

  // Detect if connecting to localhost (no auth needed)
  function isLocalServer(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.hostname === 'localhost' ||
             parsed.hostname === '127.0.0.1' ||
             parsed.hostname === '::1';
    } catch {
      return false;
    }
  }

  $: isLocal = isLocalServer(serverWsUrl);

  // Apply UI theme CSS variables whenever the theme state changes
  $: if ($themeState) {
    applyUIThemeCSS();
  }

  // Global keyboard shortcuts — delegates to the centralized KeyBindingRegistry
  function handleGlobalKeydown(event: KeyboardEvent) {
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

  // Auto-connect on mount if local
  onMount(async () => {
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
      // Try to load saved JWT token for auto-reconnection on remote servers
      const savedToken = loadToken();
      if (savedToken) {
        token = savedToken;
        // Use JWT token auth for reconnection
        connectWithJwtToken(savedToken);
      }
    }
    window.addEventListener('keydown', handleGlobalKeydown);
  });

  onDestroy(() => {
    window.removeEventListener('keydown', handleGlobalKeydown);
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
    manager = new WebSocketSessionManager(serverWsUrl);

    setupManagerEvents();

    connectionState = 'connecting';
    try {
      await manager.connect();
      console.log('[App] Connected to local server');
      isConnected = true;
      connectionState = 'connected';
      manager?.listSessions();

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

    manager.on('stateChange', (state: ConnectionState) => {
      connectionState = state;
      isConnected = state === 'connected';
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
        pendingNewTerminal = false;
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
      sessions = sessions.map(s => s.id === sessionId ? { ...s, cwd } : s);
    });

    manager.on('shutdown', (reason: string) => {
      console.log('Server shutting down:', reason);
    });

    manager.on('error', (err: Error) => {
      console.error('WebSocket error:', err);
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
    manager = new WebSocketSessionManager(serverWsUrl, token);

    setupManagerEvents();

    try {
      await manager.connect();
      console.log('[App] Connected to remote server');
      isConnected = true;
      connectionState = 'connected';
      manager?.listSessions();

      // Persist token for reconnection on page refresh
      saveToken(token);

      // Initialize workspace
      const serverWorkspace = await loadWorkspace();
      workspaceStore.initialize(serverWorkspace);
      workspaceStore.setSaveCallback(saveWorkspace);
    } catch (err) {
      console.error('[App] Remote connection failed:', err);
      isConnected = false;
      connectionState = 'disconnected';
      // Clear any stale token on connection failure
      clearToken();
      alert('Connection failed. Check console and token.');
    }
  }

  // JWT token reconnection (for saved tokens)
  async function connectWithJwtToken(jwtToken: string) {
    authError = '';
    isAuthenticating = true;

    try {
      manager = new WebSocketSessionManager(serverWsUrl);
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
      clearToken();
      token = '';
      isConnected = false;
      connectionState = 'disconnected';
      manager?.disconnect();
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
      manager = new WebSocketSessionManager(serverWsUrl);
      setupManagerEvents();

      // Listen for auth result
      const authPromise = new Promise<void>((resolve, reject) => {
        manager!.on('authenticated', (jwtToken: string) => {
          isConnected = true;
          connectionState = 'connected';
          if (rememberMe) {
            saveToken(jwtToken);
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
      manager?.disconnect();
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

      manager = new WebSocketSessionManager(serverWsUrl);
      setupManagerEvents();

      const authPromise = new Promise<void>((resolve, reject) => {
        manager!.on('authenticated', (jwtToken: string) => {
          isConnected = true;
          connectionState = 'connected';
          if (rememberMe) {
            saveToken(jwtToken);
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
      manager?.disconnect();
      manager = null;
    } finally {
      isAuthenticating = false;
    }
  }

  // Handle login events from LoginPage component
  function handlePasswordAuth(event: CustomEvent<{ username: string; password: string; rememberMe: boolean }>) {
    connectWithPassword(event.detail.username, event.detail.password, event.detail.rememberMe);
  }

  function handleSshKeyAuth(event: CustomEvent<{ username: string; privateKeyPem: string; rememberMe: boolean }>) {
    connectWithSshKey(event.detail.username, event.detail.privateKeyPem, event.detail.rememberMe);
  }

  function handleTokenAuth(event: CustomEvent<{ token: string }>) {
    token = event.detail.token;
    connect();
  }

  function handlePairingAuth(event: CustomEvent<{ code: string }>) {
    pairingCode = event.detail.code;
    exchangeCode();
  }

  function handleRetryLocal() {
    connectLocal();
  }

  // Logout: disconnect and clear token
  function logout() {
    manager?.disconnect();
    manager = null;
    isConnected = false;
    connectionState = 'disconnected';
    clearToken();
    token = '';
    sessions = [];
    authError = '';
  }

  // Terminal management functions
  function createNewTerminal() {
    pendingNewTerminal = true;
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

  function closeTerminal(sessionId: string) {
    manager?.killSession(sessionId);
  }

  function renameTerminal(sessionId: string, newName: string) {
    manager?.renameSession(sessionId, newName);
  }

  // Sidebar event handlers
  function handleSidebarToggle() {
    sidebarOpen = !sidebarOpen;
  }

  function handleSidebarSelect(event: CustomEvent<string>) {
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
        workspaceStore.assignSession(paneId, event.detail);
      }
    }
  }

  function handleSidebarClose(event: CustomEvent<string>) {
    closeTerminal(event.detail);
  }

  function handleSidebarRename(event: CustomEvent<{ id: string; newName: string }>) {
    renameTerminal(event.detail.id, event.detail.newName);
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

  function handleSettingsFromSidebar(event: CustomEvent) {
    openSettings();
  }

  // Keep broadcast store's session manager in sync
  $: setSessionManager(manager);

  // Derive active session info for the status bar
  $: activeSessionInfo = (() => {
    const ws = $workspaceStore;
    const tab = ws.tabs.find(t => t.id === ws.activeTabId);
    if (!tab) return null;

    // Find the first pane's sessionId (simple approach)
    function findFirstPaneSession(node: any): string | null {
      if (node.type === 'pane') return node.sessionId || null;
      for (const child of node.children) {
        const found = findFirstPaneSession(child);
        if (found) return found;
      }
      return null;
    }

    const sessionId = findFirstPaneSession(tab.root);
    if (!sessionId) return null;
    return sessions.find(s => s.id === sessionId) || null;
  })();
</script>

<main>
  {#if !isConnected}
    <LoginPage
      {isLocal}
      {connectionState}
      {authError}
      {isAuthenticating}
      on:passwordAuth={handlePasswordAuth}
      on:sshKeyAuth={handleSshKeyAuth}
      on:tokenAuth={handleTokenAuth}
      on:pairingAuth={handlePairingAuth}
      on:retryLocal={handleRetryLocal}
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
        <StatusBar
          sessionName={activeSessionInfo?.name || ''}
          shellType={activeSessionInfo?.shell || ''}
          {connectionState}
          sessionCount={sessions.length}
          cwd={activeSessionInfo?.cwd || ''}
          startedAt={activeSessionInfo?.started_at || ''}
        />
      </div>
      <Sidebar
        {sessions}
        activeSessionId={null}
        isOpen={sidebarOpen}
        broadcastMode={$broadcastEnabled}
        on:toggle={handleSidebarToggle}
        on:select={handleSidebarSelect}
        on:close={handleSidebarClose}
        on:rename={handleSidebarRename}
        on:create={handleSidebarCreate}
        on:settings={handleSettingsFromSidebar}
      />
    </div>
  {/if}

  <!-- Settings Panel Modal -->
  <SettingsPanel isOpen={showSettingsPanel} on:close={closeSettings} />
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
