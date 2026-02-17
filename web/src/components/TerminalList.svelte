<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import TerminalListItem from './TerminalListItem.svelte';
  import ContextMenu from './ContextMenu.svelte';
  import type { SessionInfo } from '../lib/workspaceTypes';
  import { broadcastTargets, toggleTarget, isTarget } from '../lib/broadcastStore';
  import { foregroundStore } from '../lib/foregroundStore';
  import { titleStore } from '../lib/titleStore';

  export let sessions: SessionInfo[] = [];
  export let activeSessionId: string | null = null;
  export let broadcastMode: boolean = false;

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

  // Pane drag-to-sidebar drop target
  let isPaneDragOver = false;

  function handleListDragOver(event: DragEvent) {
    if (!event.dataTransfer?.types.includes('application/x-terminar-pane')) return;
    event.preventDefault();
    isPaneDragOver = true;
  }

  function handleListDragLeave() {
    isPaneDragOver = false;
  }

  function handleListDrop(event: DragEvent) {
    isPaneDragOver = false;
    const sourcePaneId = event.dataTransfer?.getData('application/x-terminar-pane');
    if (!sourcePaneId) return;
    event.preventDefault();
    dispatch('paneDrop', { sourcePaneId });
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
  <div
    class="list-container"
    class:pane-drag-over={isPaneDragOver}
    on:dragover={handleListDragOver}
    on:dragleave={handleListDragLeave}
    on:drop={handleListDrop}
  >
    {#each sessions as session (session.id)}
      <div class="session-row" class:broadcast-mode={broadcastMode}>
        {#if broadcastMode}
          <label class="broadcast-checkbox" aria-label="Toggle broadcast target for {session.name}">
            <input
              type="checkbox"
              checked={$broadcastTargets.has(session.id)}
              on:change={() => toggleTarget(session.id)}
            />
          </label>
        {/if}
        <div class="session-item-wrapper">
          <TerminalListItem
            id={session.id}
            name={session.name}
            shell={session.shell}
            cwd={session.cwd}
            foregroundProcess={$foregroundStore.processes.get(session.id) ?? null}
            terminalTitle={$titleStore.titles.get(session.id) ?? ''}
            isActive={session.id === activeSessionId}
            startEditing={editingSessionId === session.id}
            on:select={handleSelect}
            on:close={handleClose}
            on:rename={handleRename}
            on:editend={handleEditEnd}
            on:contextmenu={handleContextMenu}
          />
        </div>
      </div>
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
    border: 2px solid transparent;
    transition: border-color 0.15s;
  }

  .list-container.pane-drag-over {
    border-color: var(--ui-accent, #0e639c);
    border-style: dashed;
  }

  .list-container::-webkit-scrollbar {
    width: 8px;
  }

  .list-container::-webkit-scrollbar-track {
    background: transparent;
  }

  .list-container::-webkit-scrollbar-thumb {
    background: var(--ui-scrollbar-thumb, rgba(121,121,121,0.4));
    border-radius: 4px;
  }

  .list-container::-webkit-scrollbar-thumb:hover {
    background: var(--ui-scrollbar-thumb-hover, rgba(121,121,121,0.7));
  }

  .session-row {
    display: flex;
    align-items: stretch;
  }

  .session-row.broadcast-mode {
    padding-left: 4px;
  }

  .session-item-wrapper {
    flex: 1;
    min-width: 0;
  }

  .broadcast-checkbox {
    display: flex;
    align-items: center;
    padding: 0 4px;
    cursor: pointer;
    flex-shrink: 0;
  }

  .broadcast-checkbox input[type="checkbox"] {
    cursor: pointer;
    accent-color: var(--ui-accent, #0e639c);
    width: 14px;
    height: 14px;
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
