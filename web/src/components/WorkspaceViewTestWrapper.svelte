<script lang="ts">
  /**
   * Test wrapper that sets up Svelte context for WorkspaceView tests.
   */
  import { reactiveBox, setManagerContext, setSessionsContext, setActionsContext, type SessionInfo } from '../lib/sessionContext.svelte';
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
    closeTerminal() {},
    renameTerminal() {},
    toggleSidebar() {},
  });

  $effect(() => {
    managerBox.value = manager;
  });
  $effect(() => {
    sessionsBox.value = initialSessions;
  });
</script>

<WorkspaceView {manager} {availableSessions} />
