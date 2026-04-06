<script lang="ts">
  import type { Tab, TabId } from '../lib/workspaceTypes';

  let {
    tabs = [],
    activeTabId = null,
    tabExitStates = new Map(),
    tabAgents = new Map(),
    onselect,
    onclose,
    oncreate,
    onrename,
    onreorder,
  }: {
    tabs?: Tab[];
    activeTabId?: TabId | null;
    /** Map of tabId -> { exited: boolean, exitCode: number | null } */
    tabExitStates?: Map<string, { exited: boolean; exitCode: number | null }>;
    /** @deprecated No longer displayed - kept for prop compat */
    tabAgents?: Map<string, { icon: string; color: string; displayName: string }>;
    onselect?: (detail: { tabId: TabId }) => void;
    onclose?: (detail: { tabId: TabId }) => void;
    oncreate?: () => void;
    onrename?: (detail: { tabId: TabId; name: string }) => void;
    onreorder?: (detail: { fromIndex: number; toIndex: number }) => void;
  } = $props();

  function getExitLabel(exitState: { exited: boolean; exitCode: number | null }): string {
    if (!exitState.exited) return '';
    if (exitState.exitCode !== null) return `[exited: ${exitState.exitCode}]`;
    return '[exited]';
  }

  let editingTabId: TabId | null = $state(null);
  let editingName = $state('');
  let draggedTabIndex: number | null = $state(null);
  let dragOverIndex: number | null = $state(null);

  function handleTabClick(tabId: TabId) {
    if (editingTabId !== tabId) {
      onselect?.({ tabId });
    }
  }

  function handleTabClose(event: MouseEvent, tabId: TabId) {
    event.stopPropagation();
    onclose?.({ tabId });
  }

  function handleDoubleClick(tabId: TabId, currentName: string) {
    editingTabId = tabId;
    editingName = currentName;
  }

  function handleRenameSubmit(tabId: TabId) {
    if (editingName.trim()) {
      onrename?.({ tabId, name: editingName.trim() });
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
    oncreate?.();
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
      onreorder?.({ fromIndex: draggedTabIndex, toIndex });
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
        onclick={() => handleTabClick(tab.id)}
        ondblclick={() => handleDoubleClick(tab.id, tab.name)}
        ondragstart={(e) => handleDragStart(e, index)}
        ondragover={(e) => handleDragOver(e, index)}
        ondragleave={handleDragLeave}
        ondrop={(e) => handleDrop(e, index)}
        ondragend={handleDragEnd}
        role="tab"
        aria-selected={tab.id === activeTabId}
        tabindex="0"
      >
        {#if editingTabId === tab.id}
          <input
            type="text"
            class="tab-rename-input"
            bind:value={editingName}
            onkeydown={(e) => handleRenameKeydown(e, tab.id)}
            onblur={() => handleRenameBlur(tab.id)}
            autofocus
          />
        {:else}
          <span class="tab-name">{tab.name}</span>
        {/if}
        {#if tabExitStates.has(tab.id) && tabExitStates.get(tab.id).exited}
          <span class="exit-badge" data-testid="exit-badge">{getExitLabel(tabExitStates.get(tab.id))}</span>
        {/if}
        <button
          class="tab-close"
          onclick={(e) => handleTabClose(e, tab.id)}
          aria-label="Close tab"
        >
          <svg width="12" height="12" viewBox="0 0 12 12">
            <path d="M2 2 L10 10 M10 2 L2 10" stroke="currentColor" stroke-width="1.5" fill="none"/>
          </svg>
        </button>
      </div>
    {/each}
  </div>

  <button class="new-tab-button" onclick={handleCreateTab} aria-label="New tab">
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
    background: var(--ui-bg-primary, #0d0e10);
    border-bottom: 1px solid var(--ui-border, #47484a);
    padding: 0 8px;
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
    background: var(--ui-scrollbar-thumb, rgba(121,121,121,0.4));
    border-radius: 3px;
  }

  .tabs-container::-webkit-scrollbar-thumb:hover {
    background: var(--ui-scrollbar-thumb-hover, rgba(121,121,121,0.7));
  }

  .tab {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    border-radius: 0;
    cursor: pointer;
    min-width: 80px;
    max-width: 200px;
    transition: border-color 0.15s, color 0.15s;
  }

  .tab:hover {
    background: transparent;
  }

  .tab.active {
    border-bottom-color: var(--ui-tab-active, #a0a7ff);
  }

  .tab.dragging {
    opacity: 0.5;
  }

  .tab.drag-over {
    border-left: 2px solid var(--ui-accent, #a0a7ff);
  }

  .tab-name {
    flex: 1;
    font-size: 13px;
    font-weight: 500;
    color: var(--ui-text-secondary, #ababad);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: color 0.15s;
  }

  .tab:hover .tab-name {
    color: var(--ui-text-primary, #fdfbfe);
  }

  .tab.active .tab-name {
    color: var(--ui-tab-active, #a0a7ff);
  }

  .exit-badge {
    font-size: 10px;
    line-height: 1;
    color: var(--ui-text-muted, #757578);
    flex-shrink: 0;
    white-space: nowrap;
  }

  .tab-rename-input {
    flex: 1;
    font-size: 12px;
    color: var(--ui-text-primary, #fdfbfe);
    background: var(--ui-bg-tertiary, #242629);
    border: 1px solid var(--ui-accent, #a0a7ff);
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
    color: var(--ui-text-muted, #757578);
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s, background 0.15s;
  }

  .tab:hover .tab-close {
    opacity: 1;
  }

  .tab-close:hover {
    background: rgba(255, 255, 255, 0.1);
    color: var(--ui-text-primary, #fdfbfe);
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
    color: var(--ui-text-muted, #757578);
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }

  .new-tab-button:hover {
    background: var(--ui-bg-tertiary, #242629);
    color: var(--ui-text-primary, #fdfbfe);
  }
</style>
