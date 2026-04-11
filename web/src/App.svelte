<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import WorkspaceView from './components/WorkspaceView.svelte';

  import Sidebar from './components/Sidebar.svelte';
  import SettingsPanel from './components/SettingsPanel.svelte';
  import ContainerPicker from './components/ContainerPicker.svelte';
  import SshConnectionPicker from './components/SshConnectionPicker.svelte';
  import SshConnectionEditor from './components/SshConnectionEditor.svelte';
  import SshConfigImportDialog from './components/SshConfigImportDialog.svelte';
  import { containerStore } from './lib/containerStore.svelte';
  import { sshConnectionStore } from './lib/sshConnectionStore.svelte';
  import type { SessionInfo, SshConnectionInfo, SshConfigHost } from './lib/shared-protocol';
  import type { ConnectionState, SessionManager } from './lib/SessionManager';
  import { createManager as singletonCreate, destroyManager as singletonDestroy, isActiveManager } from './lib/connectionSingleton';
  import { settingsStore, applyControlsZoom } from './lib/settingsStore.svelte';
  import { initializeSettings } from './lib/settingsApi';
  import { workspaceStore } from './lib/workspaceStore';
  import { applyUIThemeCSS, themeState, initAutoMode, themeStoreApi } from './lib/themeStore.svelte';
  import { initializeThemes } from './lib/themesApi';
  import { initializeTags } from './lib/tagsApi';
  import { tagStoreApi } from './lib/tagStore.svelte';
  import type { Workspace } from './lib/workspaceTypes';

  import TitleBar from './components/TitleBar.svelte';
  import BroadcastBar from './components/BroadcastBar.svelte';
  import { broadcastEnabled, clearTargets, setSessionManager } from './lib/broadcastStore.svelte';
  import { sidebarPositionStore } from './lib/sidebarPositionStore.svelte';
  import { getEffectiveEnv, cleanStaleSessionEnvVars } from './lib/envStore.svelte';
  import { getKeyBindingRegistry } from './lib/keybindings';
  import { markExited } from './lib/exitedSessionsStore.svelte';
  import { foregroundStore } from './lib/foregroundStore.svelte';
  import { sidebarGroupStore } from './lib/sidebarGroupStore.svelte';
  import { reactiveBox, setManagerContext, setSessionsContext, setActionsContext, type AppActions } from './lib/sessionContext.svelte';
  import { sessionCwdStore } from './lib/sessionCwdStore.svelte';
  import { activePaneStore } from './lib/activePaneStore.svelte';
  import { findPane } from './lib/workspaceTypes';

  const serverHttpUrl = 'http://localhost:6750';
  const serverWsUrl = 'ws://localhost:6750/ws';

  let isConnected = $state(false);
  let manager = $state<SessionManager | null>(null);

  // Session state
  let sessions = $state<SessionInfo[]>([]);
  let sidebarOpen = $state(true);

  let activeSessionId = $derived((() => {
    const pid = activePaneStore.id;
    if (!pid) return null;
    const ws = workspaceStore.get();
    const tab = ws.tabs.find(t => t.id === ws.activeTabId);
    if (!tab) return null;
    const pane = findPane(tab.root, pid);
    return pane?.sessionId ?? null;
  })());
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
    createDockerTerminal,
    createSshTerminal,
    closeTerminal,
    renameTerminal,
    toggleSidebar: () => { sidebarOpen = !sidebarOpen; },
    resetTerminal,
  };
  setActionsContext(appActions);

  // Settings panel state
  let showSettingsPanel = $state(false);
  let showContainerPicker = $state(false);
  let showSshPicker = $state(false);
  let showSshEditor = $state(false);
  let editingSshConnection = $state<SshConnectionInfo | undefined>(undefined);
  let showSshImportDialog = $state(false);

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

  // Apply UI theme CSS variables whenever the theme state changes
  $effect(() => {
    if (themeState.value) {
      applyUIThemeCSS();
    }
  });

  // Apply controls zoom whenever settings change
  $effect(() => {
    void settingsStore.value;
    applyControlsZoom();
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

  onMount(async () => {
    exposeTerminarBridge();

    // Initialize settings and themes from server (with localStorage fallback)
    await initializeSettings(settingsStore, serverHttpUrl);
    await initializeThemes(themeStoreApi, serverHttpUrl);
    await initializeTags(tagStoreApi, serverHttpUrl);

    connectLocal();
    window.addEventListener('keydown', handleGlobalKeydown);
  });

  onDestroy(() => {
    window.removeEventListener('keydown', handleGlobalKeydown);
    singletonDestroy();
    manager = null;
  });

  function handleReconnect() {
    manager?.reconnect();
  }

  // Connect to local server (no auth required)
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

    manager.on('containerList', (containers) => {
      containerStore.set(containers);
    });

    manager.on('sshConnectionList', (connections) => {
      sshConnectionStore.set(connections);
    });

    manager.on('sshConfigImportResult', (hosts) => {
      sshConnectionStore.setImportHosts(hosts);
      showSshImportDialog = true;
    });

    manager.on('sessionList', (newSessions: SessionInfo[]) => {
      console.log('Sessions:', newSessions);
      const previousSessionIds = new Set(sessions.map(s => s.id));
      const isFirstSessionList = previousSessionIds.size === 0;
      sessions = newSessions;

      // Initialize foreground store and cwd store from session list data.
      // The server only emits CwdChanged on actual changes, so freshly loaded
      // sessions need their initial cwd seeded here for split-inherit to work.
      for (const s of newSessions) {
        if (s.cwd) sessionCwdStore.set(s.id, s.cwd);
        if (s.foreground_process) {
          foregroundStore.setForeground(s.id, s.foreground_process);
        }
      }

      // Clear workspace panes that reference sessions no longer on the server
      const currentSessionIds = new Set(newSessions.map(s => s.id));
      workspaceStore.clearStaleSessions(currentSessionIds);
      cleanStaleSessionEnvVars(currentSessionIds);
      sessionCwdStore.deleteStaleSessions(currentSessionIds);

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

      // Ensure every session belongs to a group
      for (const s of sessions) {
        sidebarGroupStore.ensureSessionInGroup(s.id);
      }
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
    });

    // Route server-originated errors to the appropriate store based on error_code,
    // so that spinners don't hang forever when Docker/SSH operations fail.
    manager.on('serverError', (message: string, code: string | null) => {
      console.error('Server error:', code, message);
      if (code?.startsWith('DOCKER_')) {
        containerStore.setError(message);
      } else if (code?.startsWith('SSH_') || (code === 'INVALID_INPUT' && (showSshPicker || showSshEditor))) {
        sshConnectionStore.setError(message);
      }
    });
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
    const envVars = getEffectiveEnv();
    manager?.createSession('', '', envVars, estimatedCols, estimatedRows);
  }

  function createNewTerminalWithCwd(targetPaneId: string, cwd: string) {
    pendingNewTerminal = true;
    pendingNewTerminalPaneId = targetPaneId;
    const estimatedCols = Math.max(40, Math.floor((window.innerWidth * 0.75) / 8));
    const estimatedRows = Math.max(10, Math.floor((window.innerHeight * 0.85) / 17));
    const envVars = getEffectiveEnv();
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
    const envVars = getEffectiveEnv(sessionId);
    manager?.createSession(cwd, shell, envVars, estimatedCols, estimatedRows);
  }

  function createDockerTerminal(containerId: string, containerName: string, shell = '/bin/sh', targetPaneId?: string) {
    pendingNewTerminal = true;
    pendingNewTerminalPaneId = targetPaneId || null;
    const estimatedCols = Math.max(40, Math.floor((window.innerWidth * 0.75) / 8));
    const estimatedRows = Math.max(10, Math.floor((window.innerHeight * 0.85) / 17));
    const envVars = getEffectiveEnv();
    manager?.createSession('', shell, envVars, estimatedCols, estimatedRows, containerId);
    showContainerPicker = false;
  }

  function handleDockerCreate() {
    containerStore.setLoading();
    manager?.listContainers();
    showContainerPicker = true;
  }

  function createSshTerminal(connectionId: string, _connectionName: string, shell = '/bin/bash', targetPaneId?: string) {
    pendingNewTerminal = true;
    pendingNewTerminalPaneId = targetPaneId || null;
    const estimatedCols = Math.max(40, Math.floor((window.innerWidth * 0.75) / 8));
    const estimatedRows = Math.max(10, Math.floor((window.innerHeight * 0.85) / 17));
    const envVars = getEffectiveEnv();
    manager?.createSession('', shell, envVars, estimatedCols, estimatedRows, undefined, connectionId);
    showSshPicker = false;
  }

  function handleSshCreate() {
    sshConnectionStore.setLoading();
    manager?.listSshConnections();
    showSshPicker = true;
  }

  function handleSshAdd() {
    editingSshConnection = undefined;
    showSshEditor = true;
  }

  function handleSshEdit(conn: SshConnectionInfo) {
    editingSshConnection = conn;
    showSshEditor = true;
  }

  function handleSshSave(name: string, host: string, user: string, port: number) {
    if (editingSshConnection) {
      manager?.updateSshConnection(editingSshConnection.id, name, host, user, port);
    } else {
      manager?.addSshConnection(name, host, user, port);
    }
    showSshEditor = false;
    editingSshConnection = undefined;
  }

  function handleSshDelete(id: string) {
    manager?.removeSshConnection(id);
  }

  function handleSshImport() {
    manager?.importSshConfig();
  }

  function handleSshImportConfirm(selected: SshConfigHost[]) {
    for (const host of selected) {
      const name = host.name;
      const hostAddr = host.hostname || host.name;
      const user = host.user || 'root';
      const port = host.port || 22;
      manager?.addSshConnection(name, hostAddr, user, port);
    }
    showSshImportDialog = false;
    sshConnectionStore.clearImportHosts();
  }

  // Sidebar event handlers
  function handleSidebarToggle() {
    sidebarOpen = !sidebarOpen;
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
  <div class="app-container">
    <TitleBar
      {connectionState}
      {reconnectAttempt}
      {reconnectDelay}
      isLocalEchoMode={false}
      isLocal={true}
      onReconnect={handleReconnect}
      onLogout={() => {}}
    />
    <div class="content-area">
      <div class="main-area" style:order={sidebarPositionStore.value === 'left' ? 2 : 0}>
        <div class="workspace-area">
          <WorkspaceView />
        </div>
        {#if showBroadcastBar}
          <BroadcastBar onClose={closeBroadcastBar} />
        {/if}
      </div>
      <Sidebar
        {sessions}
        {activeSessionId}
        isOpen={sidebarOpen}
        broadcastMode={broadcastEnabled.value}
        ontoggle={() => handleSidebarToggle()}
        onclose={(sessionId) => handleSidebarClose(sessionId)}
        onrename={(detail) => handleSidebarRename(detail)}
        oncreate={() => handleSidebarCreate()}
        ondockercreate={() => handleDockerCreate()}
        onsshcreate={() => handleSshCreate()}
        onsettings={() => openSettings()}
        onToggleBroadcast={() => toggleBroadcast()}
        onpanedrop={(detail) => handleSidebarPaneDrop(detail)}
      />
    </div>
  </div>

  <!-- Settings Panel Modal -->
  <SettingsPanel isOpen={showSettingsPanel} onclose={() => closeSettings()} />

  <!-- Docker Container Picker -->
  {#if showContainerPicker}
    <ContainerPicker
      onselect={(containerId, containerName, shell) => createDockerTerminal(containerId, containerName, shell)}
      onclose={() => { showContainerPicker = false; }}
    />
  {/if}

  <!-- SSH Connection Picker -->
  {#if showSshPicker}
    <SshConnectionPicker
      onselect={(connectionId, connectionName, shell) => createSshTerminal(connectionId, connectionName, shell)}
      onadd={handleSshAdd}
      onedit={handleSshEdit}
      ondelete={handleSshDelete}
      onimport={handleSshImport}
      onclose={() => { showSshPicker = false; }}
    />
  {/if}

  <!-- SSH Connection Editor -->
  {#if showSshEditor}
    <SshConnectionEditor
      connection={editingSshConnection}
      onsave={handleSshSave}
      oncancel={() => { showSshEditor = false; editingSshConnection = undefined; }}
    />
  {/if}

  <!-- SSH Config Import Dialog -->
  {#if showSshImportDialog}
    <SshConfigImportDialog
      hosts={sshConnectionStore.importHosts}
      onimport={handleSshImportConfirm}
      onclose={() => { showSshImportDialog = false; sshConnectionStore.clearImportHosts(); }}
    />
  {/if}
</main>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    overflow: hidden;
    background: var(--ui-bg-primary, #0d0e10);
    color: var(--ui-text-primary, #fdfbfe);
    font-family: 'Space Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }

  main {
    width: 100vw;
    height: 100vh;
  }

  .app-container {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .content-area {
    flex: 1;
    display: flex;
    min-height: 0;
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
    padding: 4px 4px 6px 4px;
  }
</style>
