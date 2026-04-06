<script lang="ts">
  import TerminalListItem from './TerminalListItem.svelte';
  import ContextMenu from './ContextMenu.svelte';
  import type { SessionInfo } from '../lib/workspaceTypes';
  import { broadcastTargets, toggleTarget, isTarget } from '../lib/broadcastStore.svelte';
  import { foregroundStore } from '../lib/foregroundStore.svelte';
  import { titleStore } from '../lib/titleStore.svelte';
  import { sessionPaneCounts, newSessionIds, activeTab } from '../lib/workspaceStore';
  import { tagStore, TAG_COLORS } from '../lib/tagStore.svelte';
  import { sidebarGroupStore, type SidebarGroup } from '../lib/sidebarGroupStore.svelte';
  import { getAllPanes } from '../lib/workspaceTypes';
  import { activePaneStore } from '../lib/activePaneStore.svelte';

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

  // Sessions not in any sidebar group (attached-to-tab first)
  let ungroupedSessions = $derived((() => {
    const grouped = new Set(sidebarGroupStore.groups.flatMap(g => g.sessionIds));
    const counts = $sessionPaneCounts;
    return sessions
      .filter(s => !grouped.has(s.id))
      .sort((a, b) => {
        const aAttached = (counts.get(a.id) ?? 0) > 0 ? 1 : 0;
        const bAttached = (counts.get(b.id) ?? 0) > 0 ? 1 : 0;
        return bAttached - aAttached;
      });
  })());

  // Resolved sessions per group (filter out sessions that no longer exist, attached first)
  function resolveGroupSessions(group: SidebarGroup): SessionInfo[] {
    const sessionMap = new Map(sessions.map(s => [s.id, s]));
    const counts = $sessionPaneCounts;
    return group.sessionIds
      .map(id => sessionMap.get(id))
      .filter((s): s is SessionInfo => s !== undefined)
      .sort((a, b) => {
        const aAttached = (counts.get(a.id) ?? 0) > 0 ? 1 : 0;
        const bAttached = (counts.get(b.id) ?? 0) > 0 ? 1 : 0;
        return bAttached - aAttached;
      });
  }

  let contextMenu: { x: number; y: number; sessionId: string; groupId?: string } | null = $state(null);
  let editingSessionId: string | null = $state(null);
  let editingGroupId: string | null = $state(null);
  let editingGroupName: string = $state('');

  // New tag modal
  let newTagModal = $state<{ sessionId: string } | null>(null);
  let newTagName = $state('');
  let newTagColor = $state(TAG_COLORS[0]);
  let newTagInputEl: HTMLInputElement | undefined = $state(undefined);

  // Group settings modal
  let groupSettingsModal = $state<{ groupId: string } | null>(null);
  let gsName = $state('');
  let gsSidebarTextColor = $state('');
  let gsTitlebarBg = $state('');
  let gsTitlebarFg = $state('');

  function openGroupSettings(groupId: string) {
    const group = sidebarGroupStore.groups.find(g => g.id === groupId);
    if (!group) return;
    groupSettingsModal = { groupId };
    gsName = group.name;
    gsSidebarTextColor = group.sidebarTextColor ?? '';
    gsTitlebarBg = group.titlebarBg ?? '';
    gsTitlebarFg = group.titlebarFg ?? '';
  }

  function saveGroupSettings() {
    if (!groupSettingsModal) return;
    sidebarGroupStore.updateGroupSettings(groupSettingsModal.groupId, {
      name: gsName.trim() || 'Untitled',
      sidebarTextColor: gsSidebarTextColor || undefined,
      titlebarBg: gsTitlebarBg || undefined,
      titlebarFg: gsTitlebarFg || undefined,
    });
    groupSettingsModal = null;
  }

  function handleGsKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') saveGroupSettings();
    else if (event.key === 'Escape') groupSettingsModal = null;
  }

  function handleCreateAndAssignTag() {
    if (!newTagModal || !newTagName.trim()) return;
    const def = tagStore.addDefinition(newTagName.trim(), newTagColor);
    tagStore.toggleTagAssignment(newTagModal.sessionId, def.id);
    newTagModal = null;
  }

  function handleNewTagKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') handleCreateAndAssignTag();
    else if (event.key === 'Escape') newTagModal = null;
  }

  const sessionContextMenuItems = [
    { label: 'Rename', action: 'rename' },
    { label: '', action: '', separator: true },
    { label: 'Terminal Settings', action: 'settings' },
    { label: '', action: '', separator: true },
    { label: 'Close', action: 'close' },
  ];

  function getSessionContextMenuItems(sessionId: string) {
    const group = sidebarGroupStore.getGroupForSession(sessionId);
    const items: any[] = [...sessionContextMenuItems];
    if (group) {
      // Insert "Remove from Group" before the last separator+Close
      items.splice(items.length - 2, 0, { label: 'Remove from Group', action: 'ungroup' });
    }
    if (sidebarGroupStore.groups.length > 0) {
      // Add "Move to Group" submenu entries
      const groups = sidebarGroupStore.groups.filter(g => g.id !== group?.id);
      for (const g of groups) {
        items.splice(items.length - 2, 0, { label: `Move to "${g.name}"`, action: `move-to-group:${g.id}` });
      }
    }
    // Add Tags submenu
    const assignedIds = new Set(tagStore.getAssignedIds(sessionId));
    items.splice(items.length - 2, 0, {
      label: 'Tags', action: '', children: [
        ...tagStore.definitions.map(def => ({
          label: `${assignedIds.has(def.id) ? '\u2713 ' : '  '}${def.name}`,
          action: `toggle-tag:${def.id}`,
        })),
        ...(tagStore.definitions.length > 0 ? [{ type: 'separator' as const }] : []),
        { label: 'New Tag...', action: 'new-tag' },
      ],
    });
    return items;
  }

  const emptyContextMenuItems = [
    { label: 'New Terminal', action: 'new-terminal' },
    { label: 'New Group', action: 'new-group' },
  ];

  const groupContextMenuItems = [
    { label: 'Rename Group', action: 'rename-group' },
    { label: 'Delete Group', action: 'delete-group' },
  ];

  function handleSelect(sessionId: string) {
    const tab = $activeTab;
    if (!tab) return;
    const pane = getAllPanes(tab.root).find(p => p.sessionId === sessionId);
    if (pane) {
      activePaneStore.id = pane.id;
    }
  }

  // ── Session drag-drop for sidebar reordering ──────────────────────────────
  let draggedSessionId: string | null = $state(null);
  let draggedFromGroupId: string | null = $state(null);
  let sessionDragOverIndex: number | null = $state(null);
  let sessionDragOverGroupId: string | null = $state(null);

  function handleSessionDragStart(event: DragEvent, sessionId: string, groupId: string | null) {
    draggedSessionId = sessionId;
    draggedFromGroupId = groupId;
    event.dataTransfer?.setData('text/plain', sessionId);
    event.dataTransfer?.setData('application/x-terminar-session', sessionId);
  }

  function handleSessionDragOver(event: DragEvent, index: number, groupId: string | null) {
    if (draggedSessionId === null) return;
    event.preventDefault();
    sessionDragOverIndex = index;
    sessionDragOverGroupId = groupId;
  }

  function handleSessionDragLeave() {
    sessionDragOverIndex = null;
    sessionDragOverGroupId = null;
  }

  function handleSessionDrop(event: DragEvent, toIndex: number, toGroupId: string | null) {
    if (draggedSessionId === null) return;
    event.preventDefault();
    event.stopPropagation();

    if (toGroupId && draggedFromGroupId === toGroupId) {
      // Reorder within same group
      const group = sidebarGroupStore.groups.find(g => g.id === toGroupId);
      if (group) {
        const fromIndex = group.sessionIds.indexOf(draggedSessionId);
        if (fromIndex !== -1) {
          sidebarGroupStore.reorderInGroup(toGroupId, fromIndex, toIndex);
        }
      }
    } else if (toGroupId) {
      // Move to a different group
      sidebarGroupStore.addSession(toGroupId, draggedSessionId);
    } else if (draggedFromGroupId) {
      // Dragged out of a group to ungrouped
      sidebarGroupStore.removeSession(draggedSessionId);
    }
    // If both null (ungrouped to ungrouped), no-op for now

    resetDragState();
  }

  function handleSessionDragEnd() {
    resetDragState();
  }

  function resetDragState() {
    draggedSessionId = null;
    draggedFromGroupId = null;
    sessionDragOverIndex = null;
    sessionDragOverGroupId = null;
    groupHeaderDragOver = {};
  }

  // ── Group header drop target ──────────────────────────────────────────────
  let groupHeaderDragOver = $state<Record<string, boolean>>({});

  function handleGroupHeaderDragOver(event: DragEvent, groupId: string) {
    if (!event.dataTransfer?.types.includes('application/x-terminar-session')) return;
    event.preventDefault();
    groupHeaderDragOver = { ...groupHeaderDragOver, [groupId]: true };
  }

  function handleGroupHeaderDragLeave(groupId: string) {
    groupHeaderDragOver = { ...groupHeaderDragOver, [groupId]: false };
  }

  function handleGroupHeaderDrop(event: DragEvent, groupId: string) {
    groupHeaderDragOver = { ...groupHeaderDragOver, [groupId]: false };
    const sessionId = event.dataTransfer?.getData('application/x-terminar-session');
    if (!sessionId) return;
    event.preventDefault();
    event.stopPropagation();
    sidebarGroupStore.addSession(groupId, sessionId);
    resetDragState();
  }

  // ── Pane drag-to-sidebar drop target ──────────────────────────────────────
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

  // ── Handlers ──────────────────────────────────────────────────────────────

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

  function handleGroupContextMenu(event: MouseEvent, groupId: string) {
    event.preventDefault();
    event.stopPropagation();
    contextMenu = {
      x: event.clientX,
      y: event.clientY,
      sessionId: '',
      groupId,
    };
  }

  function handleMenuSelect(action: string) {
    if (!contextMenu) return;

    const sessionId = contextMenu.sessionId;
    const groupId = contextMenu.groupId;

    if (action === 'rename') {
      editingSessionId = sessionId;
    } else if (action === 'settings') {
      onsettings?.();
    } else if (action === 'close') {
      onclose?.(sessionId);
    } else if (action === 'new-terminal') {
      oncreate?.();
    } else if (action === 'new-group') {
      const id = sidebarGroupStore.createGroup('New Group');
      editingGroupId = id;
      editingGroupName = 'New Group';
    } else if (action === 'rename-group' && groupId) {
      const group = sidebarGroupStore.groups.find(g => g.id === groupId);
      if (group) {
        editingGroupId = groupId;
        editingGroupName = group.name;
      }
    } else if (action === 'delete-group' && groupId) {
      sidebarGroupStore.deleteGroup(groupId);
    } else if (action === 'ungroup' && sessionId) {
      sidebarGroupStore.removeSession(sessionId);
    } else if (action.startsWith('move-to-group:') && sessionId) {
      const targetGroupId = action.slice('move-to-group:'.length);
      sidebarGroupStore.addSession(targetGroupId, sessionId);
    } else if (action.startsWith('toggle-tag:') && sessionId) {
      const tagId = action.slice('toggle-tag:'.length);
      tagStore.toggleTagAssignment(sessionId, tagId);
    } else if (action === 'new-tag' && sessionId) {
      newTagModal = { sessionId };
      newTagName = '';
      newTagColor = TAG_COLORS[0];
      setTimeout(() => newTagInputEl?.focus(), 0);
    }

    contextMenu = null;
  }

  function handleEditEnd() {
    editingSessionId = null;
  }

  function handleMenuClose() {
    contextMenu = null;
  }

  function handleGroupRenameKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      commitGroupRename();
    } else if (event.key === 'Escape') {
      editingGroupId = null;
    }
  }

  function commitGroupRename() {
    if (editingGroupId && editingGroupName.trim()) {
      sidebarGroupStore.renameGroup(editingGroupId, editingGroupName.trim());
    }
    editingGroupId = null;
  }

  function handleListContextMenu(event: MouseEvent) {
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

  function toggleGroupCollapsed(groupId: string) {
    sidebarGroupStore.toggleCollapsed(groupId);
  }
</script>

{#snippet sessionRow(session: SessionInfo, index: number, groupId: string | null, sidebarColor?: string)}
  {@const isAssigned = ($sessionPaneCounts.get(session.id) ?? 0) > 0}
  <div
    class="session-row"
    class:broadcast-mode={broadcastMode}
    class:session-drag-over={sessionDragOverIndex === index && sessionDragOverGroupId === groupId}
    style={sidebarColor ? `color: ${sidebarColor}` : ''}
    draggable="true"
    ondragstart={(e) => handleSessionDragStart(e, session.id, groupId)}
    ondragover={(e) => handleSessionDragOver(e, index, groupId)}
    ondragleave={handleSessionDragLeave}
    ondrop={(e) => handleSessionDrop(e, index, groupId)}
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
        tags={tagStore.getTagsForSession(session.id)}
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
{/snippet}

<div class="terminal-list" oncontextmenu={handleListContextMenu} role="list">
  <div
    class="list-container"
    class:pane-drag-over={isPaneDragOver}
    ondragover={handleListDragOver}
    ondragleave={handleListDragLeave}
    ondrop={handleListDrop}
  >
    <!-- Ungrouped sessions (top) -->
    {#each ungroupedSessions as session, index (session.id)}
      {@render sessionRow(session, index, null)}
    {/each}

    <!-- Sidebar groups -->
    {#each sidebarGroupStore.groups as group, groupIndex (group.id)}
      {@const groupSessions = resolveGroupSessions(group)}
      <div class="sidebar-group">
        <div
          class="group-header"
          class:group-header-drag-over={groupHeaderDragOver[group.id]}
          style={group.sidebarTextColor ? `color: ${group.sidebarTextColor}` : ''}
          ondragover={(e) => handleGroupHeaderDragOver(e, group.id)}
          ondragleave={() => handleGroupHeaderDragLeave(group.id)}
          ondrop={(e) => handleGroupHeaderDrop(e, group.id)}
          oncontextmenu={(e) => handleGroupContextMenu(e, group.id)}
          role="heading"
          aria-level={2}
        >
          <button
            class="group-collapse-btn"
            onclick={() => toggleGroupCollapsed(group.id)}
            aria-label={group.collapsed ? 'Expand group' : 'Collapse group'}
          >
            <span class="collapse-icon" class:collapsed={group.collapsed}>&#9662;</span>
          </button>
          {#if editingGroupId === group.id}
            <input
              class="group-name-input"
              type="text"
              bind:value={editingGroupName}
              onkeydown={handleGroupRenameKeydown}
              onblur={commitGroupRename}
              autofocus
            />
          {:else}
            <span class="group-name" ondblclick={() => {
              editingGroupId = group.id;
              editingGroupName = group.name;
            }}>{group.name}</span>
          {/if}
          <span class="group-count">{groupSessions.length}</span>
          <button
            class="group-settings-btn"
            onclick={(e) => { e.stopPropagation(); openGroupSettings(group.id); }}
            aria-label="Group settings"
            title="Group settings"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <path fill-rule="evenodd" clip-rule="evenodd" d="M9.1 4.4L8.6 2H7.4L6.9 4.4L6.5 4.6L4.4 3.5L3.5 4.4L4.6 6.5L4.4 6.9L2 7.4V8.6L4.4 9.1L4.6 9.5L3.5 11.6L4.4 12.5L6.5 11.4L6.9 11.6L7.4 14H8.6L9.1 11.6L9.5 11.4L11.6 12.5L12.5 11.6L11.4 9.5L11.6 9.1L14 8.6V7.4L11.6 6.9L11.4 6.5L12.5 4.4L11.6 3.5L9.5 4.6L9.1 4.4ZM8 10C9.1046 10 10 9.1046 10 8C10 6.8954 9.1046 6 8 6C6.8954 6 6 6.8954 6 8C6 9.1046 6.8954 10 8 10Z"/>
            </svg>
          </button>
          {#if groupHeaderDragOver[group.id]}
            <span class="group-drop-hint">Drop here</span>
          {/if}
        </div>
        {#if !group.collapsed}
          {#each groupSessions as session, index (session.id)}
            {@render sessionRow(session, index, group.id, group.sidebarTextColor)}
          {/each}
        {/if}
      </div>
    {/each}
  </div>
</div>

{#if contextMenu}
  <ContextMenu
    x={contextMenu.x}
    y={contextMenu.y}
    items={contextMenu.groupId
      ? groupContextMenuItems
      : contextMenu.sessionId
        ? getSessionContextMenuItems(contextMenu.sessionId)
        : emptyContextMenuItems}
    onselect={(action) => handleMenuSelect(action)}
    onclose={handleMenuClose}
  />
{/if}

{#if newTagModal}
  <div class="new-tag-backdrop" onclick={() => newTagModal = null} role="presentation">
    <div class="new-tag-modal" onclick={(e) => e.stopPropagation()}>
      <div class="new-tag-header">New Tag</div>
      <input
        class="new-tag-input"
        type="text"
        bind:value={newTagName}
        bind:this={newTagInputEl}
        onkeydown={handleNewTagKeydown}
        placeholder="Tag name"
      />
      <div class="new-tag-color-picker">
        {#each TAG_COLORS as color}
          <button
            class="new-tag-color-swatch"
            class:selected={newTagColor === color}
            style="background: {color}"
            onclick={() => newTagColor = color}
          ></button>
        {/each}
      </div>
      <div class="new-tag-actions">
        <button class="new-tag-btn cancel" onclick={() => newTagModal = null}>Cancel</button>
        <button class="new-tag-btn confirm" onclick={handleCreateAndAssignTag} disabled={!newTagName.trim()}>Create</button>
      </div>
    </div>
  </div>
{/if}

{#if groupSettingsModal}
  <div class="new-tag-backdrop" onclick={() => groupSettingsModal = null} role="presentation">
    <div class="gs-modal" onclick={(e) => e.stopPropagation()} onkeydown={handleGsKeydown}>
      <div class="gs-header">Group Settings</div>

      <label class="gs-label">Name</label>
      <input class="gs-input" type="text" bind:value={gsName} />

      <label class="gs-label">Sidebar Text Color</label>
      <div class="gs-color-row">
        <input class="gs-color-input" type="text" bind:value={gsSidebarTextColor} placeholder="#777 or empty for default" />
        <input class="gs-color-picker" type="color" value={gsSidebarTextColor || '#777777'} oninput={(e) => gsSidebarTextColor = (e.target as HTMLInputElement).value} />
        {#if gsSidebarTextColor}
          <button class="gs-clear-btn" onclick={() => gsSidebarTextColor = ''} title="Clear">&times;</button>
        {/if}
      </div>

      <label class="gs-label">Titlebar Background</label>
      <div class="gs-color-row">
        <input class="gs-color-input" type="text" bind:value={gsTitlebarBg} placeholder="#0d0e10 or empty for default" />
        <input class="gs-color-picker" type="color" value={gsTitlebarBg || '#0d0e10'} oninput={(e) => gsTitlebarBg = (e.target as HTMLInputElement).value} />
        {#if gsTitlebarBg}
          <button class="gs-clear-btn" onclick={() => gsTitlebarBg = ''} title="Clear">&times;</button>
        {/if}
      </div>

      <label class="gs-label">Titlebar Foreground</label>
      <div class="gs-color-row">
        <input class="gs-color-input" type="text" bind:value={gsTitlebarFg} placeholder="#ababad or empty for default" />
        <input class="gs-color-picker" type="color" value={gsTitlebarFg || '#ababad'} oninput={(e) => gsTitlebarFg = (e.target as HTMLInputElement).value} />
        {#if gsTitlebarFg}
          <button class="gs-clear-btn" onclick={() => gsTitlebarFg = ''} title="Clear">&times;</button>
        {/if}
      </div>

      {#if gsTitlebarBg || gsTitlebarFg}
        <div class="gs-preview" style="background: {gsTitlebarBg || 'var(--ui-bg-primary, #0d0e10)'}; color: {gsTitlebarFg || 'var(--ui-text-secondary, #ababad)'};">
          Preview: {gsName || 'Tab'}
        </div>
      {/if}

      <div class="new-tag-actions">
        <button class="new-tag-btn cancel" onclick={() => groupSettingsModal = null}>Cancel</button>
        <button class="new-tag-btn confirm" onclick={saveGroupSettings}>Save</button>
      </div>
    </div>
  </div>
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

  .session-item-wrapper.assigned {
    /* icon-only indicator, no opacity change */
  }

  /* ── New tag modal ─────────────────────────────────────────────────── */

  .new-tag-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1100;
  }

  .new-tag-modal {
    background: var(--ui-bg-secondary, #181a1c);
    border: 1px solid var(--ui-border, #454545);
    border-radius: 6px;
    padding: 16px;
    min-width: 280px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  }

  .new-tag-header {
    font-size: 14px;
    font-weight: 500;
    color: var(--ui-text-primary, #fdfbfe);
    margin-bottom: 12px;
  }

  .new-tag-input {
    width: 100%;
    padding: 8px 10px;
    background: var(--ui-bg-tertiary, #242629);
    border: 1px solid var(--ui-border, #555);
    border-radius: 4px;
    color: var(--ui-text-primary, #fdfbfe);
    font-size: 13px;
    box-sizing: border-box;
  }

  .new-tag-input:focus {
    outline: none;
    border-color: var(--ui-accent, #a0a7ff);
  }

  .new-tag-color-picker {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
    margin: 8px 0 4px;
  }

  .new-tag-color-swatch {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    padding: 0;
  }

  .new-tag-color-swatch.selected {
    border-color: white;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.3);
  }

  .new-tag-color-swatch:hover {
    transform: scale(1.15);
  }

  .new-tag-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 12px;
  }

  .new-tag-btn {
    padding: 6px 14px;
    border: 1px solid var(--ui-border, #555);
    border-radius: 4px;
    font-size: 13px;
    cursor: pointer;
  }

  .new-tag-btn.cancel {
    background: var(--ui-bg-tertiary, #242629);
    color: var(--ui-text-primary, #fdfbfe);
  }

  .new-tag-btn.cancel:hover {
    background: var(--ui-bg-hover, #4a4a4a);
  }

  .new-tag-btn.confirm {
    background: var(--ui-accent, #a0a7ff);
    color: white;
    border-color: var(--ui-accent, #a0a7ff);
  }

  .new-tag-btn.confirm:hover {
    filter: brightness(1.1);
  }

  .new-tag-btn.confirm:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* ── Sidebar groups ────────────────────────────────────────────────── */

  .sidebar-group {
    margin-bottom: 2px;
  }

  .group-header {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px 4px 2px;
    margin-top: 2px;
    font-size: 12px;
    font-weight: 600;
    color: var(--ui-text-muted, #777);
    border-bottom: 1px solid var(--ui-border, #47484a);
    cursor: default;
    transition: background 0.1s, border-color 0.1s;
  }

  .sidebar-group:first-child .group-header {
    margin-top: 0;
  }

  .group-header.group-header-drag-over {
    background: rgba(14, 99, 156, 0.15);
    border-color: var(--ui-accent, #a0a7ff);
    color: var(--ui-accent, #a0a7ff);
  }

  .group-collapse-btn {
    background: none;
    border: none;
    padding: 0 2px;
    cursor: pointer;
    color: inherit;
    font-size: 10px;
    line-height: 1;
    display: flex;
    align-items: center;
  }

  .collapse-icon {
    display: inline-block;
    transition: transform 0.15s;
  }

  .collapse-icon.collapsed {
    transform: rotate(-90deg);
  }

  .group-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
    cursor: default;
  }

  .group-name-input {
    flex: 1;
    min-width: 0;
    background: var(--ui-bg-secondary, #181a1c);
    border: 1px solid var(--ui-accent, #a0a7ff);
    border-radius: 2px;
    color: var(--ui-text-primary, #fdfbfe);
    font-size: 12px;
    font-weight: 600;
    padding: 1px 4px;
    outline: none;
  }

  .group-count {
    color: var(--ui-text-muted, #555);
    font-size: 9px;
    font-weight: 400;
    flex-shrink: 0;
  }

  .group-drop-hint {
    font-size: 9px;
    color: var(--ui-accent, #a0a7ff);
    flex-shrink: 0;
    margin-left: 4px;
  }

  .group-settings-btn {
    background: none;
    border: none;
    padding: 2px;
    cursor: pointer;
    color: inherit;
    opacity: 0.5;
    display: flex;
    align-items: center;
    border-radius: 3px;
    transition: opacity 0.15s, background 0.15s;
    flex-shrink: 0;
  }

  .group-settings-btn:hover {
    opacity: 1;
    background: rgba(255, 255, 255, 0.1);
  }

  /* ── Group settings modal ──────────────────────────────────────────── */

  .gs-modal {
    background: var(--ui-bg-secondary, #181a1c);
    border: 1px solid var(--ui-border, #454545);
    border-radius: 6px;
    padding: 16px;
    min-width: 300px;
    max-width: 360px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  }

  .gs-header {
    font-size: 14px;
    font-weight: 500;
    color: var(--ui-text-primary, #fdfbfe);
    margin-bottom: 14px;
  }

  .gs-label {
    display: block;
    font-size: 11px;
    font-weight: 500;
    color: var(--ui-text-muted, #757578);
    margin-bottom: 4px;
    margin-top: 10px;
  }

  .gs-label:first-of-type {
    margin-top: 0;
  }

  .gs-input {
    width: 100%;
    padding: 6px 8px;
    background: var(--ui-bg-tertiary, #242629);
    border: 1px solid var(--ui-border, #555);
    border-radius: 4px;
    color: var(--ui-text-primary, #fdfbfe);
    font-size: 13px;
    box-sizing: border-box;
  }

  .gs-input:focus {
    outline: none;
    border-color: var(--ui-accent, #a0a7ff);
  }

  .gs-color-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .gs-color-input {
    flex: 1;
    min-width: 0;
    padding: 6px 8px;
    background: var(--ui-bg-tertiary, #242629);
    border: 1px solid var(--ui-border, #555);
    border-radius: 4px;
    color: var(--ui-text-primary, #fdfbfe);
    font-size: 13px;
  }

  .gs-color-input:focus {
    outline: none;
    border-color: var(--ui-accent, #a0a7ff);
  }

  .gs-color-picker {
    width: 30px;
    height: 30px;
    padding: 0;
    border: 1px solid var(--ui-border, #555);
    border-radius: 4px;
    cursor: pointer;
    flex-shrink: 0;
    background: none;
  }

  .gs-clear-btn {
    background: none;
    border: none;
    color: var(--ui-text-muted, #757578);
    cursor: pointer;
    font-size: 16px;
    padding: 0 4px;
    flex-shrink: 0;
  }

  .gs-clear-btn:hover {
    color: var(--ui-text-primary, #fdfbfe);
  }

  .gs-preview {
    margin-top: 12px;
    padding: 8px 12px;
    border-radius: 4px;
    font-size: 13px;
    font-weight: 500;
    text-align: center;
  }

</style>
