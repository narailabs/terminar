<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import WorkspaceView from './components/WorkspaceView.svelte';
  import ConnectionStatus from './components/ConnectionStatus.svelte';
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

  // Settings panel state
  let showSettingsPanel = false;

  // Shortcuts popup state
  let showShortcutsPopup = false;
  let shortcutsTimeout: ReturnType<typeof setTimeout> | null = null;

  function toggleShortcuts() {
    if (shortcutsTimeout) {
      clearTimeout(shortcutsTimeout);
      shortcutsTimeout = null;
    }
    showShortcutsPopup = !showShortcutsPopup;
    if (showShortcutsPopup) {
      // Auto-close after 8 seconds
      shortcutsTimeout = setTimeout(() => {
        showShortcutsPopup = false;
        shortcutsTimeout = null;
      }, 8000);
      // Close on outside click
      setTimeout(() => {
        window.addEventListener('click', closeShortcutsOnOutsideClick, { once: true, capture: true });
      });
    }
  }

  function closeShortcutsOnOutsideClick(e: MouseEvent) {
    const wrapper = (e.target as HTMLElement)?.closest('.shortcuts-wrapper');
    if (!wrapper) {
      showShortcutsPopup = false;
      if (shortcutsTimeout) {
        clearTimeout(shortcutsTimeout);
        shortcutsTimeout = null;
      }
    } else {
      // Click was inside wrapper, re-register
      setTimeout(() => {
        window.addEventListener('click', closeShortcutsOnOutsideClick, { once: true, capture: true });
      });
    }
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

  // Keyboard shortcuts for sidebar toggle
  function handleGlobalKeydown(event: KeyboardEvent) {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const modifier = isMac ? event.metaKey : event.ctrlKey;

    // Ctrl/Cmd + B: Toggle sidebar
    if (modifier && event.key === 'b') {
      event.preventDefault();
      sidebarOpen = !sidebarOpen;
    }

    // Ctrl/Cmd + Shift + N: New terminal (create session)
    if (modifier && event.shiftKey && event.key === 'N') {
      event.preventDefault();
      createNewTerminal();
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

  // Parse an SSH private key (PEM format) and return the public key string and sign function
  // Uses Web Crypto API for ed25519 signing
  async function parseSshPrivateKey(pem: string): Promise<{
    publicKeyStr: string;
    algorithm: string;
    signFn: (nonce: string) => Promise<string>;
  }> {
    // For now, support Ed25519 keys in OpenSSH format
    // The private key parsing is done client-side using Web Crypto
    // The key never leaves the browser
    const lines = pem.trim().split('\n');
    if (!lines[0].includes('OPENSSH PRIVATE KEY') && !lines[0].includes('BEGIN')) {
      throw new Error('Unsupported key format. Please use an OpenSSH private key.');
    }

    // Extract base64 content between header/footer
    const b64Lines = lines.filter(l => !l.startsWith('-----')).join('');
    const keyData = Uint8Array.from(atob(b64Lines), c => c.charCodeAt(0));

    // Parse OpenSSH private key format
    // Format: "openssh-key-v1\0" + cipher + kdf + kdf_options + num_keys + public_key + private_key
    const decoder = new TextDecoder();
    const magic = decoder.decode(keyData.slice(0, 15));
    if (magic !== 'openssh-key-v1\0') {
      throw new Error('Not an OpenSSH private key format');
    }

    let offset = 15;

    function readString(): Uint8Array {
      const len = new DataView(keyData.buffer, keyData.byteOffset + offset, 4).getUint32(0);
      offset += 4;
      const data = keyData.slice(offset, offset + len);
      offset += len;
      return data;
    }

    const ciphername = decoder.decode(readString());
    const _kdfname = readString(); // kdf name
    const _kdfoptions = readString(); // kdf options
    const numKeys = new DataView(keyData.buffer, keyData.byteOffset + offset, 4).getUint32(0);
    offset += 4;

    if (ciphername !== 'none') {
      throw new Error('Encrypted SSH keys are not supported in the browser. Please use an unencrypted key.');
    }
    if (numKeys !== 1) {
      throw new Error('Multi-key SSH files are not supported');
    }

    // Read public key blob
    const pubKeyBlob = readString();
    // Read private key section
    const privSection = readString();

    // Parse public key blob to get algorithm
    let pkOffset = 0;
    function readPubString(): Uint8Array {
      const len = new DataView(pubKeyBlob.buffer, pubKeyBlob.byteOffset + pkOffset, 4).getUint32(0);
      pkOffset += 4;
      const data = pubKeyBlob.slice(pkOffset, pkOffset + len);
      pkOffset += len;
      return data;
    }

    const algorithm = decoder.decode(readPubString());
    if (algorithm !== 'ssh-ed25519') {
      throw new Error(`Unsupported key algorithm: ${algorithm}. Only ssh-ed25519 is supported in the browser.`);
    }

    const pubKeyBytes = readPubString(); // 32 bytes for ed25519

    // Build the OpenSSH public key string (algorithm + base64 blob)
    const publicKeyStr = `ssh-ed25519 ${btoa(String.fromCharCode(...pubKeyBlob))}`;

    // Parse private section to get the seed (private key bytes)
    let privOffset = 0;
    function readPrivString(): Uint8Array {
      const len = new DataView(privSection.buffer, privSection.byteOffset + privOffset, 4).getUint32(0);
      privOffset += 4;
      const data = privSection.slice(privOffset, privOffset + len);
      privOffset += len;
      return data;
    }

    // Check numbers (random uint32 repeated twice)
    const check1 = new DataView(privSection.buffer, privSection.byteOffset, 4).getUint32(0);
    const check2 = new DataView(privSection.buffer, privSection.byteOffset + 4, 4).getUint32(0);
    if (check1 !== check2) {
      throw new Error('Key decryption failed (checkints do not match). Key may be encrypted.');
    }
    privOffset = 8;

    const _privAlgo = readPrivString(); // algorithm again
    const _privPubKey = readPrivString(); // public key again
    const privKeyFull = readPrivString(); // 64 bytes: seed (32) + pubkey (32)
    const seed = privKeyFull.slice(0, 32); // ed25519 seed

    // Import the key into Web Crypto for signing
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      seed,
      { name: 'Ed25519' },
      false,
      ['sign'],
    ).catch(() => {
      throw new Error('Your browser does not support Ed25519 signing. Try a recent Chrome or Firefox.');
    });

    const signFn = async (nonce: string): Promise<string> => {
      const nonceBytes = Uint8Array.from(atob(nonce), c => c.charCodeAt(0));
      const signature = await crypto.subtle.sign('Ed25519', cryptoKey, nonceBytes);
      return btoa(String.fromCharCode(...new Uint8Array(signature)));
    };

    return { publicKeyStr, algorithm, signFn };
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
    manager?.createSession('', '', {}, estimatedCols, estimatedRows);
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

  // Convert sessions to format expected by WorkspaceView
  $: availableSessions = sessions.map(s => ({ id: s.id, name: s.name }));
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
        <div class="status-bar">
          {#if isLocalEchoMode}
            <div class="local-echo-badge">
              <span class="badge-dot"></span>
              LOCAL PTY MODE - Main Server Bypassed
            </div>
          {:else}
            <ConnectionStatus
              state={connectionState}
              {reconnectAttempt}
              {reconnectDelay}
              onReconnect={handleReconnect}
            />
          {/if}
          <div class="status-bar-right">
            <div class="shortcuts-wrapper">
              <button
                class="shortcuts-btn"
                on:click={toggleShortcuts}
                title="Keyboard Shortcuts"
                aria-label="Show keyboard shortcuts"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M1 4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4zm1 0v8h12V4H2zm1.5 1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-1 0v-1a.5.5 0 0 1 .5-.5zm2 0a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-1 0v-1a.5.5 0 0 1 .5-.5zm2 0a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-1 0v-1a.5.5 0 0 1 .5-.5zm2 0a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-1 0v-1a.5.5 0 0 1 .5-.5zm2 0a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-1 0v-1a.5.5 0 0 1 .5-.5zM3.5 8a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-1 0v-1a.5.5 0 0 1 .5-.5zm8 0a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-1 0v-1a.5.5 0 0 1 .5-.5zm-6 0h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1 0-1z"/>
                </svg>
              </button>
              {#if showShortcutsPopup}
                <div class="shortcuts-popup">
                  <div class="shortcuts-title">Keyboard Shortcuts</div>
                  <div class="shortcut-row"><kbd>Cmd+B</kbd> <span>Toggle sidebar</span></div>
                  <div class="shortcut-row"><kbd>Cmd+Shift+N</kbd> <span>New terminal</span></div>
                  <div class="shortcut-row"><kbd>Cmd+T</kbd> <span>New tab</span></div>
                  <div class="shortcut-row"><kbd>Cmd+W</kbd> <span>Close pane</span></div>
                  <div class="shortcut-row"><kbd>Cmd+Shift+E</kbd> <span>Split right</span></div>
                  <div class="shortcut-row"><kbd>Cmd+Shift+O</kbd> <span>Split down</span></div>
                  <div class="shortcut-row"><kbd>Cmd+1-9</kbd> <span>Switch tab</span></div>
                </div>
              {/if}
            </div>
            {#if !isLocal}
              <button
                class="logout-btn"
                on:click={logout}
                title="Logout"
                aria-label="Logout and disconnect"
              >Logout</button>
            {/if}
            <button
              class="settings-btn"
              on:click={openSettings}
              title="Terminal Settings"
              aria-label="Open terminal settings"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path fill-rule="evenodd" clip-rule="evenodd" d="M9.1 4.4L8.6 2H7.4L6.9 4.4L6.5 4.6L4.4 3.5L3.5 4.4L4.6 6.5L4.4 6.9L2 7.4V8.6L4.4 9.1L4.6 9.5L3.5 11.6L4.4 12.5L6.5 11.4L6.9 11.6L7.4 14H8.6L9.1 11.6L9.5 11.4L11.6 12.5L12.5 11.6L11.4 9.5L11.6 9.1L14 8.6V7.4L11.6 6.9L11.4 6.5L12.5 4.4L11.6 3.5L9.5 4.6L9.1 4.4ZM8 10C9.1046 10 10 9.1046 10 8C10 6.8954 9.1046 6 8 6C6.8954 6 6 6.8954 6 8C6 9.1046 6.8954 10 8 10Z"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="workspace-area">
          <WorkspaceView {manager} {availableSessions} />
        </div>
      </div>
      <Sidebar
        {sessions}
        activeSessionId={null}
        isOpen={sidebarOpen}
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

  .status-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 12px;
    background: var(--ui-bg-primary, #1e1e1e);
    border-bottom: 1px solid var(--ui-border, #3c3c3c);
    flex-shrink: 0;
  }

  .status-bar-right {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .shortcuts-wrapper {
    position: relative;
  }

  .shortcuts-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: var(--ui-text-muted, #888);
    cursor: pointer;
    transition: all 0.15s;
  }

  .shortcuts-btn:hover {
    background: var(--ui-bg-tertiary, #3c3c3c);
    color: var(--ui-text-primary, #cccccc);
  }

  .shortcuts-popup {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 6px;
    background: var(--ui-bg-secondary, #252526);
    border: 1px solid var(--ui-border, #3c3c3c);
    border-radius: 6px;
    padding: 10px 14px;
    min-width: 240px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    z-index: 1000;
    animation: fadeIn 0.15s ease-out;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .shortcuts-title {
    font-size: 11px;
    font-weight: 600;
    color: var(--ui-text-secondary, #aaa);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 8px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--ui-border, #3c3c3c);
  }

  .shortcut-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 3px 0;
    font-size: 12px;
    color: var(--ui-text-primary, #ccc);
  }

  .shortcut-row kbd {
    font-family: inherit;
    font-size: 11px;
    color: var(--ui-text-primary, #ddd);
    background: var(--ui-bg-tertiary, #3c3c3c);
    border: 1px solid var(--ui-border, #505050);
    border-radius: 3px;
    padding: 1px 6px;
    min-width: 0;
  }

  .shortcut-row span {
    color: var(--ui-text-muted, #999);
    margin-left: 16px;
  }

  .logout-btn {
    padding: 4px 10px;
    background: transparent;
    border: 1px solid var(--ui-border, #555);
    border-radius: 4px;
    color: var(--ui-text-muted, #888);
    cursor: pointer;
    font-size: 12px;
    transition: all 0.15s;
  }

  .logout-btn:hover {
    background: var(--ui-bg-tertiary, #3c3c3c);
    color: var(--ui-destructive, #ff6b6b);
    border-color: var(--ui-destructive, #ff6b6b);
  }

  .settings-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: var(--ui-text-muted, #888);
    cursor: pointer;
    transition: all 0.15s;
  }

  .settings-btn:hover {
    background: var(--ui-bg-tertiary, #3c3c3c);
    color: var(--ui-text-primary, #cccccc);
  }

  .settings-btn:active {
    background: var(--ui-bg-tertiary, #454545);
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

  .local-echo-badge {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 12px;
    background: #3a3d41;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    color: #e5c07b;
    letter-spacing: 0.5px;
  }

  .badge-dot {
    width: 8px;
    height: 8px;
    background: #e5c07b;
    border-radius: 50%;
    animation: pulse 2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
</style>
