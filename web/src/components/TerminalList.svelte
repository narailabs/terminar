<script lang="ts">
  import TerminalListItem from './TerminalListItem.svelte';
  import ContextMenu from './ContextMenu.svelte';
  import type { SessionInfo } from '../lib/workspaceTypes';
  import { broadcastTargets, toggleTarget, isTarget } from '../lib/broadcastStore.svelte';
  import { foregroundStore } from '../lib/foregroundStore.svelte';
  import { titleStore } from '../lib/titleStore.svelte';
  import { sessionPaneCounts, newSessionIds, workspaceStore } from '../lib/workspaceStore';
  import { focusedPane } from '../lib/focusStore.svelte';

  let {
    sessions = [],
    activeSessionId = null,
    broadcastMode = false,
    onselect,
    onclose,
    onrename,
    oncreate,
    onsettings,
    onpanedrop,
  }: {
    sessions?: SessionInfo[];
    activeSessionId?: string | null;
    broadcastMode?: boolean;
    onselect?: (sessionId: string) => void;
    onclose?: (sessionId: string) => void;
    onrename?: (detail: { id: string; newName: string }) => void;
    oncreate?: () => void;
    onsettings?: () => void;
    onpanedrop?: (detail: { sourcePaneId: string }) => void;
  } = $props();

  let contextMenu: { x: number; y: number; sessionId: string } | null = $state(null);
  let editingSessionId: string | null = $state(null);

  const contextMenuItems = [
    { label: 'Rename', action: 'rename' },
    { label: '', action: '', separator: true },
    { label: 'Terminal Settings', action: 'settings' },
    { label: '', action: '', separator: true },
    { label: 'Close', action: 'close' },
  ];

  function handleSelect(sessionId: string) {
    // Assign clicked session to the currently focused pane instead of switching active terminal
    const focusedPaneId = focusedPane.id;
    if (focusedPaneId) {
      workspaceStore.assignSession(focusedPaneId, sessionId);
    } else {
      onselect?.(sessionId);
    }
  }

  // ── Session drag-drop for sidebar reordering ──────────────────────────────
  let draggedSessionIndex: number | null = $state(null);
  let sessionDragOverIndex: number | null = $state(null);

  function handleSessionDragStart(event: DragEvent, sessionId: string, index: number) {
    draggedSessionIndex = index;
    event.dataTransfer?.setData('text/plain', sessionId);
    event.dataTransfer?.setData('application/x-terminar-session', sessionId);
  }

  function handleSessionDragOver(event: DragEvent, index: number) {
    if (draggedSessionIndex === null) return;
    event.preventDefault();
    sessionDragOverIndex = index;
  }

  function handleSessionDragLeave() {
    sessionDragOverIndex = null;
  }

  function handleSessionDrop(event: DragEvent, toIndex: number) {
    if (draggedSessionIndex === null) return;
    event.preventDefault();
    event.stopPropagation();
    const activeTabId = workspaceStore.get().activeTabId;
    workspaceStore.reorderSession(activeTabId, draggedSessionIndex, toIndex);
    draggedSessionIndex = null;
    sessionDragOverIndex = null;
  }

  function handleSessionDragEnd() {
    draggedSessionIndex = null;
    sessionDragOverIndex = null;
  }

  function handleClose(sessionId: string) {
    onclose?.(sessionId);
  }

  function handleRename(detail: { id: string; newName: string }) {
    onrename?.(detail);
  }

  function handleContextMenu(detail: { id: string; x: number; y: number }) {
    contextMenu = {
      x: detail.x,
      y: detail.y,
      sessionId: detail.id,
    };
  }

  function handleMenuSelect(action: string) {
    if (!contextMenu) return;

    const sessionId = contextMenu.sessionId;

    if (action === 'rename') {
      // Trigger rename mode on the session item
      editingSessionId = sessionId;
    } else if (action === 'settings') {
      onsettings?.();
    } else if (action === 'close') {
      onclose?.(sessionId);
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
  let isPaneDragOver = $state(false);

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
    onpanedrop?.({ sourcePaneId });
  }

  function handleNewTerminal() {
    oncreate?.();
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

<div class="terminal-list" oncontextmenu={handleListContextMenu} role="list">
  <div
    class="list-container"
    class:pane-drag-over={isPaneDragOver}
    ondragover={handleListDragOver}
    ondragleave={handleListDragLeave}
    ondrop={handleListDrop}
  >
    {#each sessions as session, index (session.id)}
      <div
        class="session-row"
        class:broadcast-mode={broadcastMode}
        class:session-drag-over={sessionDragOverIndex === index}
        draggable="true"
        ondragstart={(e) => handleSessionDragStart(e, session.id, index)}
        ondragover={(e) => handleSessionDragOver(e, index)}
        ondragleave={handleSessionDragLeave}
        ondrop={(e) => handleSessionDrop(e, index)}
        ondragend={handleSessionDragEnd}
      >
        {#if broadcastMode}
          <label class="broadcast-checkbox" aria-label="Toggle broadcast target for {session.name}">
            <input
              type="checkbox"
              checked={broadcastTargets.value.has(session.id)}
              onchange={() => toggleTarget(session.id)}
            />
          </label>
        {/if}
        <div class="session-item-wrapper">
          <TerminalListItem
            id={session.id}
            name={session.name}
            shell={session.shell}
            cwd={session.cwd}
            foregroundProcess={foregroundStore.processes.get(session.id) ?? null}
            terminalTitle={titleStore.titles.get(session.id) ?? ''}
            paneCount={$sessionPaneCounts.get(session.id) ?? 0}
            isActive={session.id === activeSessionId}
            startEditing={editingSessionId === session.id}
            onselect={handleSelect}
            onclose={handleClose}
            onrename={handleRename}
            oneditend={() => handleEditEnd()}
            oncontextmenu={handleContextMenu}
          />
          {#if $newSessionIds.has(session.id)}
            <span class="new-badge"> (new)</span>
          {/if}
        </div>
      </div>
    {/each}
  </div>

  <button class="new-terminal-btn" onclick={handleNewTerminal}>
    <span class="plus-icon">+</span>
    <span class="btn-text">New Terminal</span>
  </button>
</div>

{#if contextMenu}
  <ContextMenu
    x={contextMenu.x}
    y={contextMenu.y}
    items={contextMenu.sessionId ? contextMenuItems : [{ label: 'New Terminal', action: 'new' }]}
    onselect={(action) => {
      if (action === 'new') {
        handleNewTerminal();
        contextMenu = null;
      } else {
        handleMenuSelect(action);
      }
    }}
    onclose={handleMenuClose}
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
    cursor: grab;
  }

  .session-row:active {
    cursor: grabbing;
  }

  .session-row.broadcast-mode {
    padding-left: 4px;
  }

  .session-row.session-drag-over {
    outline: 2px solid var(--ui-accent, #0e639c);
    outline-offset: -2px;
    border-radius: 2px;
  }

  .session-item-wrapper {
    flex: 1;
    min-width: 0;
    position: relative;
  }

  .new-badge {
    color: var(--text-secondary, #888);
    font-style: italic;
    font-size: 11px;
    pointer-events: none;
    position: absolute;
    right: 6px;
    top: 50%;
    transform: translateY(-50%);
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
    margin: 8px 6px 8px 2px;
    padding: 10px 8px 10px 4px;
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
