<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import WorkspaceView from './components/WorkspaceView.svelte';
  import Sidebar from './components/Sidebar.svelte';
  import AppToolbar from './components/AppToolbar.svelte';
  import BroadcastBar from './components/BroadcastBar.svelte';
  import { ElectronSessionManager } from './lib/ElectronSessionManager';
  import type { ConnectionState, SessionManager } from './lib/SessionManager';
  import { settingsStore } from './lib/settingsStore.svelte';
  import { workspaceStore } from './lib/workspaceStore';
  import { applyUIThemeCSS, themeState, initAutoMode } from './lib/themeStore.svelte';
  import type { Workspace } from './lib/workspaceTypes';

  import { broadcastEnabled, clearTargets, setSessionManager } from './lib/broadcastStore.svelte';
  import { getEffectiveEnv } from './lib/envStore.svelte';
  import { getKeyBindingRegistry } from './lib/keybindings';
  import { activityStore } from './lib/activityStore.svelte';
  import { markExited } from './lib/exitedSessionsStore.svelte';
  import { foregroundStore } from './lib/foregroundStore.svelte';
  import { reactiveBox, setManagerContext, setSessionsContext, setActionsContext, type AppActions } from './lib/sessionContext.svelte';

  interface SessionInfo {
    id: string;
    name: string;
    shell: string;
    cwd: string;
    started_at: string;
  }

  let isConnected = $state(false);
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

  // Actions context for child components
  const appActions: AppActions = {
    createNewTerminal,
    closeTerminal,
    renameTerminal,
    toggleSidebar: () => { sidebarOpen = !sidebarOpen; },
    resetTerminal,
  };
  setActionsContext(appActions);

  // Broadcast bar state
  let showBroadcastBar = $state(false);

  function toggleBroadcast() {
    if (broadcastEnabled.value) {
      showBroadcastBar = false;
      broadcastEnabled.value = false;
      clearTargets();
    } else {
      broadcastEnabled.value = true;
      showBroadcastBar = true;
    }
  }

  function closeBroadcastBar() {
    showBroadcastBar = false;
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

  // Listen for OS color scheme changes when mode is 'auto'
  initAutoMode();

  // Global keyboard shortcuts
  function handleGlobalKeydown(event: KeyboardEvent) {
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

  onMount(async () => {
    // Create the IPC-based session manager
    const mgr = new ElectronSessionManager();
    manager = mgr;

    setupManagerEvents();

    connectionState = 'connecting';
    try {
      await mgr.connect();
      console.log('[TerminalApp] Connected to server via IPC');
      isConnected = true;
      connectionState = 'connected';
      mgr.listSessions();

      // Initialize workspace from cache (no HTTP server in Electron mode)
      workspaceStore.initialize(null);
    } catch (err) {
      console.error('[TerminalApp] Connection failed:', err);
      isConnected = false;
      connectionState = 'disconnected';
    }

    window.addEventListener('keydown', handleGlobalKeydown);
  });

  onDestroy(() => {
    window.removeEventListener('keydown', handleGlobalKeydown);
    if (manager) {
      manager.disconnect();
      manager = null;
    }
  });

  function handleReconnect() {
    manager?.reconnect();
  }

  // Setup event handlers for the manager
  function setupManagerEvents() {
    if (!manager) return;
    manager.removeAllListeners();

    manager.on('stateChange', (state: ConnectionState) => {
      connectionState = state;
      if (state === 'connected') {
        isConnected = true;
      } else if (state === 'disconnected') {
        isConnected = false;
      }
    });

    manager.on('sessionList', (newSessions: SessionInfo[]) => {
      console.log('[TerminalApp] Sessions:', newSessions);
      const previousSessionIds = new Set(sessions.map(s => s.id));
      const isFirstSessionList = previousSessionIds.size === 0;
      sessions = newSessions;

      // Initialize foreground store from session list data
      for (const s of newSessions) {
        if ((s as Record<string, unknown>).foreground_process) {
          foregroundStore.setForeground(s.id, (s as Record<string, unknown>).foreground_process as string);
        }
      }

      // Clear workspace panes that reference sessions no longer on the server
      const currentSessionIds = new Set(newSessions.map(s => s.id));
      workspaceStore.clearStaleSessions(currentSessionIds);

      function findEmptyPane(node: Record<string, unknown>): string | null {
        if (node.type === 'pane') {
          return node.sessionId === null ? node.id as string : null;
        }
        for (const child of node.children as Record<string, unknown>[]) {
          const found = findEmptyPane(child);
          if (found) return found;
        }
        return null;
      }

      if (sessions.length === 0) {
        createNewTerminal();
      } else if (isFirstSessionList && sessions.length > 0) {
        const ws = workspaceStore.get();
        const tab = ws.tabs.find(t => t.id === ws.activeTabId);
        if (tab) {
          const emptyPaneId = findEmptyPane(tab.root as unknown as Record<string, unknown>);
          if (emptyPaneId) {
            workspaceStore.assignSession(emptyPaneId, sessions[0].id);
          }
        }
      } else if (pendingNewTerminal) {
        const newSession = sessions.find(s => !previousSessionIds.has(s.id));
        if (newSession) {
          if (pendingNewTerminalPaneId) {
            workspaceStore.assignSession(pendingNewTerminalPaneId, newSession.id);
          } else {
            const ws = workspaceStore.get();
            const tab = ws.tabs.find(t => t.id === ws.activeTabId);
            if (tab) {
              const emptyPaneId = findEmptyPane(tab.root as unknown as Record<string, unknown>);
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
      activityStore.setActivity(sessionId, activityType as 'activity' | 'bell' | 'silence');
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
      console.log('[TerminalApp] Server shutting down:', reason);
    });

    manager.on('error', (err: Error) => {
      console.error('[TerminalApp] Error:', err);
    });
  }

  // Terminal management functions
  function createNewTerminal(targetPaneId?: string) {
    pendingNewTerminal = true;
    pendingNewTerminalPaneId = targetPaneId || null;
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

  function handleSidebarClose(sessionId: string) {
    closeTerminal(sessionId);
  }

  function handleSidebarRename(detail: { id: string; newName: string }) {
    renameTerminal(detail.id, detail.newName);
  }

  function handleSidebarCreate() {
    createNewTerminal();
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
    <div class="main-area">
      <AppToolbar
        {connectionState}
        {reconnectAttempt}
        {reconnectDelay}
        isLocalEchoMode={false}
        isLocal={true}
        onReconnect={handleReconnect}
        onLogout={() => {}}
        onSettings={() => {}}
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
      onclose={(sessionId) => handleSidebarClose(sessionId)}
      onrename={(detail) => handleSidebarRename(detail)}
      oncreate={() => handleSidebarCreate()}
      onsettings={() => {}}
      onpanedrop={(detail) => handleSidebarPaneDrop(detail)}
    />
  </div>
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
    padding: 4px 4px 6px 4px;
  }
</style>
