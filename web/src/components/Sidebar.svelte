<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import TerminalList from './TerminalList.svelte';
  import type { SessionInfo } from '../lib/workspaceTypes';

  export let sessions: SessionInfo[] = [];
  export let activeSessionId: string | null = null;
  export let isOpen: boolean = true;
  export let broadcastMode: boolean = false;

  const dispatch = createEventDispatcher();

  function toggle() {
    dispatch('toggle');
  }

  function handleSelect(event: CustomEvent<string>) {
    dispatch('select', event.detail);
  }

  function handleClose(event: CustomEvent<string>) {
    dispatch('close', event.detail);
  }

  function handleRename(event: CustomEvent<{ id: string; newName: string }>) {
    dispatch('rename', event.detail);
  }

  function handleCreate() {
    dispatch('create');
  }

  function handleSettings() {
    dispatch('settings');
  }
</script>

<div class="sidebar" class:open={isOpen}>
  <button class="toggle-btn" on:click={toggle} title={isOpen ? 'Hide sidebar' : 'Show sidebar'}>
    <span class="chevron">{isOpen ? '›' : '‹'}</span>
  </button>

  {#if isOpen}
    <div class="sidebar-content">
      <div class="sidebar-header">
        <h3>Terminals</h3>
        <span class="count">{sessions.length}</span>
      </div>
      <TerminalList
        {sessions}
        {activeSessionId}
        {broadcastMode}
        on:select={handleSelect}
        on:close={handleClose}
        on:rename={handleRename}
        on:create={handleCreate}
        on:settings={handleSettings}
      />
    </div>
  {/if}
</div>

<style>
  .sidebar {
    display: flex;
    background: var(--ui-bg-secondary, #252526);
    border-left: 1px solid var(--ui-border, #3c3c3c);
    height: 100%;
    transition: width 0.15s ease;
  }

  .sidebar:not(.open) {
    width: 24px;
  }

  .sidebar.open {
    width: 250px;
  }

  .toggle-btn {
    width: 24px;
    height: 100%;
    background: none;
    border: none;
    color: var(--ui-text-muted, #808080);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: background 0.1s;
  }

  .toggle-btn:hover {
    background: var(--ui-bg-secondary, #2a2a2a);
    color: var(--ui-text-primary, #cccccc);
  }

  .chevron {
    font-size: 16px;
    font-weight: bold;
  }

  .sidebar-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 0;
  }

  .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--ui-border, #3c3c3c);
  }

  .sidebar-header h3 {
    margin: 0;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--ui-text-primary, #cccccc);
  }

  .count {
    background: var(--ui-bg-tertiary, #3c3c3c);
    color: var(--ui-text-primary, #cccccc);
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 10px;
    min-width: 18px;
    text-align: center;
  }
</style>
