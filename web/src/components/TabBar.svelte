<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Tab, TabId } from '../lib/workspaceTypes';

  export let tabs: Tab[] = [];
  export let activeTabId: TabId | null = null;
  /** Map of tabId -> activity type (for background tab activity badges) */
  export let tabActivities: Map<string, string> = new Map();
  /** Map of tabId -> { exited: boolean, exitCode: number | null } */
  export let tabExitStates: Map<string, { exited: boolean; exitCode: number | null }> = new Map();
  /** Map of tabId -> { icon: string, color: string, displayName: string } */
  export let tabAgents: Map<string, { icon: string; color: string; displayName: string }> = new Map();

  function getActivityIcon(activityType: string): string {
    switch (activityType) {
      case 'bell': return '\u{1F514}'; // 🔔
      case 'silence': return '\u{1F4A4}'; // 💤
      default: return '\u{25CF}'; // ● dot
    }
  }

  function getExitLabel(exitState: { exited: boolean; exitCode: number | null }): string {
    if (!exitState.exited) return '';
    if (exitState.exitCode !== null) return `[exited: ${exitState.exitCode}]`;
    return '[exited]';
  }

  const dispatch = createEventDispatcher<{
    select: { tabId: TabId };
    close: { tabId: TabId };
    create: void;
    rename: { tabId: TabId; name: string };
    reorder: { fromIndex: number; toIndex: number };
  }>();

  let editingTabId: TabId | null = null;
  let editingName = '';
  let draggedTabIndex: number | null = null;
  let dragOverIndex: number | null = null;

  function handleTabClick(tabId: TabId) {
    if (editingTabId !== tabId) {
      dispatch('select', { tabId });
    }
  }

  function handleTabClose(event: MouseEvent, tabId: TabId) {
    event.stopPropagation();
    dispatch('close', { tabId });
  }

  function handleDoubleClick(tabId: TabId, currentName: string) {
    editingTabId = tabId;
    editingName = currentName;
  }

  function handleRenameSubmit(tabId: TabId) {
    if (editingName.trim()) {
      dispatch('rename', { tabId, name: editingName.trim() });
    }
    editingTabId = null;
    editingName = '';
  }

  function handleRenameKeydown(event: KeyboardEvent, tabId: TabId) {
    if (event.key === 'Enter') {
      handleRenameSubmit(tabId);
    } else if (event.key === 'Escape') {
      editingTabId = null;
      editingName = '';
    }
  }

  function handleRenameBlur(tabId: TabId) {
    handleRenameSubmit(tabId);
  }

  function handleCreateTab() {
    dispatch('create');
  }

  // Drag and drop for reordering tabs
  function handleDragStart(event: DragEvent, index: number) {
    draggedTabIndex = index;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(index));
    }
  }

  function handleDragOver(event: DragEvent, index: number) {
    event.preventDefault();
    if (draggedTabIndex !== null && draggedTabIndex !== index) {
      dragOverIndex = index;
    }
  }

  function handleDragLeave() {
    dragOverIndex = null;
  }

  function handleDrop(event: DragEvent, toIndex: number) {
    event.preventDefault();
    if (draggedTabIndex !== null && draggedTabIndex !== toIndex) {
      dispatch('reorder', { fromIndex: draggedTabIndex, toIndex });
    }
    draggedTabIndex = null;
    dragOverIndex = null;
  }

  function handleDragEnd() {
    draggedTabIndex = null;
    dragOverIndex = null;
  }
</script>

<div class="tab-bar">
  <div class="tabs-container">
    {#each tabs as tab, index}
      <div
        class="tab"
        class:active={tab.id === activeTabId}
        class:dragging={draggedTabIndex === index}
        class:drag-over={dragOverIndex === index}
        draggable="true"
        on:click={() => handleTabClick(tab.id)}
        on:dblclick={() => handleDoubleClick(tab.id, tab.name)}
        on:dragstart={(e) => handleDragStart(e, index)}
        on:dragover={(e) => handleDragOver(e, index)}
        on:dragleave={handleDragLeave}
        on:drop={(e) => handleDrop(e, index)}
        on:dragend={handleDragEnd}
        role="tab"
        aria-selected={tab.id === activeTabId}
        tabindex="0"
      >
        {#if tabAgents.has(tab.id)}
          {@const agent = tabAgents.get(tab.id)}
          <span class="agent-icon" data-testid="agent-icon" style="color: {agent.color}" title={agent.displayName}>{agent.icon}</span>
        {/if}
        {#if editingTabId === tab.id}
          <input
            type="text"
            class="tab-rename-input"
            bind:value={editingName}
            on:keydown={(e) => handleRenameKeydown(e, tab.id)}
            on:blur={() => handleRenameBlur(tab.id)}
            autofocus
          />
        {:else}
          <span class="tab-name">{tab.name}</span>
        {/if}
        {#if tabActivities.has(tab.id) && tab.id !== activeTabId}
          <span class="activity-badge" data-testid="activity-badge">{getActivityIcon(tabActivities.get(tab.id))}</span>
        {/if}
        {#if tabExitStates.has(tab.id) && tabExitStates.get(tab.id).exited}
          <span class="exit-badge" data-testid="exit-badge">{getExitLabel(tabExitStates.get(tab.id))}</span>
        {/if}
        <button
          class="tab-close"
          on:click={(e) => handleTabClose(e, tab.id)}
          aria-label="Close tab"
        >
          <svg width="12" height="12" viewBox="0 0 12 12">
            <path d="M2 2 L10 10 M10 2 L2 10" stroke="currentColor" stroke-width="1.5" fill="none"/>
          </svg>
        </button>
      </div>
    {/each}
  </div>

  <button class="new-tab-button" on:click={handleCreateTab} aria-label="New tab">
    <svg width="14" height="14" viewBox="0 0 14 14">
      <path d="M7 2 L7 12 M2 7 L12 7" stroke="currentColor" stroke-width="1.5" fill="none"/>
    </svg>
  </button>
</div>

<style>
  .tab-bar {
    display: flex;
    align-items: center;
    height: 35px;
    background: var(--ui-bg-secondary, #252526);
    border-bottom: 1px solid var(--ui-border, #3c3c3c);
    padding: 0 4px;
    gap: 4px;
    user-select: none;
  }

  .tabs-container {
    display: flex;
    flex: 1;
    overflow-x: auto;
    gap: 2px;
  }

  .tabs-container::-webkit-scrollbar {
    height: 3px;
  }

  .tabs-container::-webkit-scrollbar-track {
    background: transparent;
  }

  .tabs-container::-webkit-scrollbar-thumb {
    background: var(--ui-text-muted, #555);
    border-radius: 3px;
  }

  .tab {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    background: var(--ui-bg-secondary, #2d2d2d);
    border: 1px solid transparent;
    border-radius: 4px 4px 0 0;
    cursor: pointer;
    min-width: 80px;
    max-width: 200px;
    transition: background 0.15s;
  }

  .tab:hover {
    background: var(--ui-bg-tertiary, #3c3c3c);
  }

  .tab.active {
    background: var(--ui-bg-primary, #1e1e1e);
    border-color: var(--ui-border, #3c3c3c);
    border-bottom-color: var(--ui-bg-primary, #1e1e1e);
  }

  .tab.dragging {
    opacity: 0.5;
  }

  .tab.drag-over {
    border-left: 2px solid var(--ui-accent, #0e639c);
  }

  .tab-name {
    flex: 1;
    font-size: 12px;
    color: var(--ui-text-primary, #ccc);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tab.active .tab-name {
    color: var(--ui-text-primary, #fff);
  }

  .agent-icon {
    font-size: 10px;
    line-height: 1;
    flex-shrink: 0;
  }

  .activity-badge {
    font-size: 10px;
    line-height: 1;
    flex-shrink: 0;
  }

  .exit-badge {
    font-size: 10px;
    line-height: 1;
    color: var(--ui-text-muted, #888);
    flex-shrink: 0;
    white-space: nowrap;
  }

  .tab-rename-input {
    flex: 1;
    font-size: 12px;
    color: var(--ui-text-primary, #fff);
    background: var(--ui-bg-tertiary, #3c3c3c);
    border: 1px solid var(--ui-accent, #0e639c);
    border-radius: 2px;
    padding: 2px 4px;
    outline: none;
    min-width: 50px;
  }

  .tab-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: 3px;
    color: var(--ui-text-muted, #888);
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s, background 0.15s;
  }

  .tab:hover .tab-close {
    opacity: 1;
  }

  .tab-close:hover {
    background: rgba(255, 255, 255, 0.1);
    color: var(--ui-text-primary, #fff);
  }

  .new-tab-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: var(--ui-text-muted, #888);
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }

  .new-tab-button:hover {
    background: var(--ui-bg-tertiary, #3c3c3c);
    color: var(--ui-text-primary, #fff);
  }
</style>
