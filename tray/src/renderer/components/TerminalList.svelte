<script lang="ts">
  import TerminalListItem from './TerminalListItem.svelte';
  import ContextMenu from './ContextMenu.svelte';
  import type { SessionInfo } from '../lib/workspaceTypes';
  import { broadcastTargets, toggleTarget, isTarget } from '../lib/broadcastStore.svelte';
  import { foregroundStore } from '../lib/foregroundStore.svelte';
  import { titleStore } from '../lib/titleStore.svelte';
  import { sessionPaneCounts, newSessionIds, workspaceStore } from '../lib/workspaceStore';
  import { tagStore } from '../lib/tagStore.svelte';

  let {
    sessions = [],
    activeSessionId = null,
    broadcastMode = false,
    onclose,
    onrename,
    oncreate,
    onsettings,
    onpanedrop,
  }: {
    sessions?: SessionInfo[];
    activeSessionId?: string | null;
    broadcastMode?: boolean;
    onclose?: (sessionId: string) => void;
    onrename?: (detail: { id: string; newName: string }) => void;
    oncreate?: () => void;
    onsettings?: () => void;
    onpanedrop?: (detail: { sourcePaneId: string }) => void;
  } = $props();

  // Reactive workspace subscription for tab grouping
  let _wsStore = $state(workspaceStore.get());
  $effect(() => {
    const unsub = workspaceStore.subscribe((w) => { _wsStore = w; });
    return unsub;
  });

  // Group sessions by tab: returns array of { tab, sessions[] } in tab order
  let tabGroups = $derived((() => {
    const sessionMap = new Map(sessions.map(s => [s.id, s]));
    return _wsStore.tabs.map(tab => ({
      tab,
      sessions: tab.sessionOrder
        .map(id => sessionMap.get(id))
        .filter((s): s is SessionInfo => s !== undefined),
    })).filter(group => group.sessions.length > 0 || _wsStore.tabs.length > 1);
  })());

  // Sessions not in any tab's sessionOrder (orphans)
  let orphanSessions = $derived((() => {
    const allOrdered = new Set(_wsStore.tabs.flatMap(t => t.sessionOrder));
    return sessions.filter(s => !allOrdered.has(s.id));
  })());

  let contextMenu: { x: number; y: number; sessionId: string } | null = $state(null);
  let editingSessionId: string | null = $state(null);

  const contextMenuItems = [
    { label: 'Rename', action: 'rename' },
    { label: '', action: '', separator: true },
    { label: 'Terminal Settings', action: 'settings' },
    { label: '', action: '', separator: true },
    { label: 'Close', action: 'close' },
  ];

  function handleSelect(_sessionId: string) {
    // Click on sidebar item is a no-op — sessions are attached via drag-drop or context menu only
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

  // Tab header drag-over state: tabId -> boolean
  let tabHeaderDragOver = $state<Record<string, boolean>>({});

  function handleTabHeaderDragOver(event: DragEvent, tabId: string) {
    if (!event.dataTransfer?.types.includes('application/x-terminar-session')) return;
    event.preventDefault();
    tabHeaderDragOver = { ...tabHeaderDragOver, [tabId]: true };
  }

  function handleTabHeaderDragLeave(tabId: string) {
    tabHeaderDragOver = { ...tabHeaderDragOver, [tabId]: false };
  }

  function handleTabHeaderDrop(event: DragEvent, toTabId: string) {
    tabHeaderDragOver = { ...tabHeaderDragOver, [toTabId]: false };
    const sessionId = event.dataTransfer?.getData('application/x-terminar-session');
    if (!sessionId) return;
    event.preventDefault();
    event.stopPropagation();
    const fromTabId = workspaceStore.get().activeTabId;
    if (fromTabId !== toTabId) {
      workspaceStore.moveSessionToTab(sessionId, fromTabId, toTabId);
    }
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
    {#if tabGroups.length > 1}
      <!-- Multi-tab view: show sessions grouped by tab with drop targets on headers -->
      {#each tabGroups as group (group.tab.id)}
        <div
          class="tab-group-header"
          class:tab-header-drag-over={tabHeaderDragOver[group.tab.id]}
          ondragover={(e) => handleTabHeaderDragOver(e, group.tab.id)}
          ondragleave={() => handleTabHeaderDragLeave(group.tab.id)}
          ondrop={(e) => handleTabHeaderDrop(e, group.tab.id)}
          role="heading"
          aria-level={2}
        >
          <span class="tab-group-name">{group.tab.name}</span>
          {#if tabHeaderDragOver[group.tab.id]}
            <span class="tab-drop-hint">Drop here</span>
          {/if}
        </div>
        {#each group.sessions as session, index (session.id)}
          {@const globalIndex = sessions.findIndex(s => s.id === session.id)}
          {@const isAssigned = ($sessionPaneCounts.get(session.id) ?? 0) > 0}
          <div
            class="session-row"
            class:broadcast-mode={broadcastMode}
            class:session-drag-over={sessionDragOverIndex === globalIndex}
            draggable="true"
            ondragstart={(e) => handleSessionDragStart(e, session.id, globalIndex)}
            ondragover={(e) => handleSessionDragOver(e, globalIndex)}
            ondragleave={handleSessionDragLeave}
            ondrop={(e) => handleSessionDrop(e, globalIndex)}
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
            <div class="session-item-wrapper" class:assigned={isAssigned}>
              <TerminalListItem
                id={session.id}
                name={session.name}
                shell={session.shell}
                cwd={session.cwd}
                foregroundProcess={foregroundStore.processes.get(session.id) ?? null}
                terminalTitle={titleStore.titles.get(session.id) ?? ''}
                paneCount={$sessionPaneCounts.get(session.id) ?? 0}
                tags={tagStore.getTags(session.id)}
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
      {/each}
      <!-- Orphan sessions (not in any tab) -->
      {#each orphanSessions as session, index (session.id)}
        {@const globalIndex = sessions.findIndex(s => s.id === session.id)}
        {@const isAssigned = ($sessionPaneCounts.get(session.id) ?? 0) > 0}
        <div
          class="session-row"
          class:broadcast-mode={broadcastMode}
          class:session-drag-over={sessionDragOverIndex === globalIndex}
          draggable="true"
          ondragstart={(e) => handleSessionDragStart(e, session.id, globalIndex)}
          ondragover={(e) => handleSessionDragOver(e, globalIndex)}
          ondragleave={handleSessionDragLeave}
          ondrop={(e) => handleSessionDrop(e, globalIndex)}
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
          <div class="session-item-wrapper" class:assigned={isAssigned}>
            <TerminalListItem
              id={session.id}
              name={session.name}
              shell={session.shell}
              cwd={session.cwd}
              foregroundProcess={foregroundStore.processes.get(session.id) ?? null}
              terminalTitle={titleStore.titles.get(session.id) ?? ''}
              paneCount={$sessionPaneCounts.get(session.id) ?? 0}
                tags={tagStore.getTags(session.id)}
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
    {:else}
      <!-- Single-tab view: flat list -->
      {#each sessions as session, index (session.id)}
        {@const isAssigned = ($sessionPaneCounts.get(session.id) ?? 0) > 0}
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
          <div class="session-item-wrapper" class:assigned={isAssigned}>
            <TerminalListItem
              id={session.id}
              name={session.name}
              shell={session.shell}
              cwd={session.cwd}
              foregroundProcess={foregroundStore.processes.get(session.id) ?? null}
              terminalTitle={titleStore.titles.get(session.id) ?? ''}
              paneCount={$sessionPaneCounts.get(session.id) ?? 0}
                tags={tagStore.getTags(session.id)}
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
    {/if}
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
    border-color: var(--ui-accent, #a0a7ff);
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
    outline: 2px solid var(--ui-accent, #a0a7ff);
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
    accent-color: var(--ui-accent, #a0a7ff);
    width: 14px;
    height: 14px;
  }

  .tab-group-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 8px 2px 6px;
    margin-top: 6px;
    font-size: 10px;
    font-weight: 600;
    color: var(--ui-text-muted, #777);
    border-bottom: 1px solid var(--ui-border, #47484a);
    cursor: default;
    transition: background 0.1s, border-color 0.1s;
  }

  .tab-group-header:first-child {
    margin-top: 0;
  }

  .tab-group-header.tab-header-drag-over {
    background: rgba(14, 99, 156, 0.15);
    border-color: var(--ui-accent, #a0a7ff);
    color: var(--ui-accent, #a0a7ff);
  }

  .tab-group-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tab-drop-hint {
    font-size: 9px;
    color: var(--ui-accent, #a0a7ff);
    flex-shrink: 0;
    margin-left: 4px;
  }

  .session-item-wrapper.assigned {
    opacity: 0.6;
  }

  .new-terminal-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 8px 6px 8px 2px;
    padding: 10px 8px 10px 4px;
    background: var(--ui-bg-secondary, #181a1c);
    border: 1px dashed #454545;
    border-radius: 4px;
    color: #808080;
    cursor: pointer;
    font-size: 13px;
    transition: all 0.1s;
  }

  .new-terminal-btn:hover {
    background: var(--ui-bg-tertiary, #363636);
    border-color: var(--ui-accent, #a0a7ff);
    color: var(--ui-text-primary, #fdfbfe);
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
