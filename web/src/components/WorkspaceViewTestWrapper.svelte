<script lang="ts">
  /**
   * Test wrapper that sets up Svelte context for WorkspaceView tests.
   */
  import { writable } from 'svelte/store';
  import { setManagerContext, setSessionsContext, setActionsContext, type SessionInfo } from '../lib/sessionContext';
  import type { SessionManager } from '../lib/SessionManager';
  import WorkspaceView from './WorkspaceView.svelte';

  export let manager: SessionManager | null = null;
  export let availableSessions: { id: string; name?: string }[] = [];
  export let initialSessions: SessionInfo[] = [];

  const managerStore = writable<SessionManager | null>(manager);
  const sessionsStore = writable<SessionInfo[]>(initialSessions);
  setManagerContext(managerStore);
  setSessionsContext(sessionsStore);
  setActionsContext({
    createNewTerminal() {},
    closeTerminal() {},
    renameTerminal() {},
    toggleSidebar() {},
  });

  $: managerStore.set(manager);
  $: sessionsStore.set(initialSessions);
</script>

<WorkspaceView {manager} {availableSessions} />
