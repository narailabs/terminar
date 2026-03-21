<script lang="ts">
  /**
   * Test wrapper that sets up Svelte context for WorkspaceView tests.
   */
  import { reactiveBox, setManagerContext, setSessionsContext, setActionsContext, setPaneActionsContext, type SessionInfo } from '../lib/sessionContext.svelte';
  import type { SessionManager } from '../lib/SessionManager';
  import WorkspaceView from './WorkspaceView.svelte';

  let {
    manager = null,
    availableSessions = [],
    initialSessions = [],
  }: {
    manager?: SessionManager | null;
    availableSessions?: { id: string; name?: string }[];
    initialSessions?: SessionInfo[];
  } = $props();

  const managerBox = reactiveBox<SessionManager | null>(manager);
  const sessionsBox = reactiveBox<SessionInfo[]>(initialSessions);
  setManagerContext(managerBox);
  setSessionsContext(sessionsBox);
  setActionsContext({
    createNewTerminal() {},
    createNewTerminalWithCwd() {},
    closeTerminal() {},
    renameTerminal() {},
    toggleSidebar() {},
    resetTerminal() {},
  });
  setPaneActionsContext({
    drop() {},
    paneDrop() {},
    contextMenu() {},
    focus() {},
    detach() {},
    kill() {},
    closePaneAction() {},
    splitHorizontal() {},
    splitVertical() {},
    commitResize() {},
    toggleFocus() {},
  });

  $effect(() => {
    managerBox.value = manager;
  });
  $effect(() => {
    sessionsBox.value = initialSessions;
  });
</script>

<WorkspaceView {manager} {availableSessions} />
