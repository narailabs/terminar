<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import TerminalListItem from './TerminalListItem.svelte';
  import ContextMenu from './ContextMenu.svelte';
  import type { SessionInfo } from '../lib/workspaceTypes';

  export let sessions: SessionInfo[] = [];
  export let activeSessionId: string | null = null;

  const dispatch = createEventDispatcher();

  let contextMenu: { x: number; y: number; sessionId: string } | null = null;
  let editingSessionId: string | null = null;

  const contextMenuItems = [
    { label: 'Rename', action: 'rename' },
    { label: '', action: '', separator: true },
    { label: 'Terminal Settings', action: 'settings' },
    { label: '', action: '', separator: true },
    { label: 'Close', action: 'close' },
  ];

  function handleSelect(event: CustomEvent<string>) {
    dispatch('select', event.detail);
  }

  function handleClose(event: CustomEvent<string>) {
    dispatch('close', event.detail);
  }

  function handleRename(event: CustomEvent<{ id: string; newName: string }>) {
    dispatch('rename', event.detail);
  }

  function handleContextMenu(event: CustomEvent<{ id: string; x: number; y: number }>) {
    contextMenu = {
      x: event.detail.x,
      y: event.detail.y,
      sessionId: event.detail.id,
    };
  }

  function handleMenuSelect(event: CustomEvent<string>) {
    if (!contextMenu) return;

    const action = event.detail;
    const sessionId = contextMenu.sessionId;

    if (action === 'rename') {
      // Trigger rename mode on the session item
      editingSessionId = sessionId;
    } else if (action === 'settings') {
      dispatch('settings');
    } else if (action === 'close') {
      dispatch('close', sessionId);
    }

    contextMenu = null;
  }

  function handleEditEnd() {
    editingSessionId = null;
  }

  function handleMenuClose() {
    contextMenu = null;
  }

  function handleNewTerminal() {
    dispatch('create');
  }

  function handleListContextMenu(event: MouseEvent) {
    // Only show context menu if clicked on empty space (not on an item)
    const target = event.target as HTMLElement;
    if (target.classList.contains('terminal-list') || target.classList.contains('list-container')) {
      event.preventDefault();
      contextMenu = {
        x: event.clientX,
        y: event.clientY,
        sessionId: '',
      };
    }
  }
</script>

<div class="terminal-list" on:contextmenu={handleListContextMenu} role="list">
  <div class="list-container">
    {#each sessions as session (session.id)}
      <TerminalListItem
        id={session.id}
        name={session.name}
        shell={session.shell}
        cwd={session.cwd}
        isActive={session.id === activeSessionId}
        startEditing={editingSessionId === session.id}
        on:select={handleSelect}
        on:close={handleClose}
        on:rename={handleRename}
        on:editend={handleEditEnd}
        on:contextmenu={handleContextMenu}
      />
    {/each}
  </div>

  <button class="new-terminal-btn" on:click={handleNewTerminal}>
    <span class="plus-icon">+</span>
    <span class="btn-text">New Terminal</span>
  </button>
</div>

{#if contextMenu}
  <ContextMenu
    x={contextMenu.x}
    y={contextMenu.y}
    items={contextMenu.sessionId ? contextMenuItems : [{ label: 'New Terminal', action: 'new' }]}
    on:select={(e) => {
      if (e.detail === 'new') {
        handleNewTerminal();
        contextMenu = null;
      } else {
        handleMenuSelect(e);
      }
    }}
    on:close={handleMenuClose}
  />
{/if}

<style>
  .terminal-list {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .list-container {
    flex: 1;
    overflow-y: auto;
    padding: 8px 0;
  }

  .list-container::-webkit-scrollbar {
    width: 8px;
  }

  .list-container::-webkit-scrollbar-track {
    background: transparent;
  }

  .list-container::-webkit-scrollbar-thumb {
    background: var(--ui-bg-tertiary, #424242);
    border-radius: 4px;
  }

  .list-container::-webkit-scrollbar-thumb:hover {
    background: #4f4f4f;
  }

  .new-terminal-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 8px;
    padding: 10px 12px;
    background: var(--ui-bg-secondary, #2d2d2d);
    border: 1px dashed #454545;
    border-radius: 4px;
    color: #808080;
    cursor: pointer;
    font-size: 13px;
    transition: all 0.1s;
  }

  .new-terminal-btn:hover {
    background: var(--ui-bg-tertiary, #363636);
    border-color: var(--ui-accent, #0e639c);
    color: var(--ui-text-primary, #cccccc);
  }

  .plus-icon {
    font-size: 18px;
    font-weight: 300;
    line-height: 1;
  }

  .btn-text {
    flex: 1;
    text-align: left;
  }
</style>
