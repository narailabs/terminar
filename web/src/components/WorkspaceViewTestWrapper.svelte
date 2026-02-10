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

  const managerStore = writable<SessionManager | null>(manager);
  const sessionsStore = writable<SessionInfo[]>([]);
  setManagerContext(managerStore);
  setSessionsContext(sessionsStore);
  setActionsContext({
    createNewTerminal() {},
    closeTerminal() {},
    renameTerminal() {},
    toggleSidebar() {},
  });

  $: managerStore.set(manager);
</script>

<WorkspaceView {manager} {availableSessions} />
