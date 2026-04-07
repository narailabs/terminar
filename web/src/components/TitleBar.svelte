<script lang="ts">
  import { onMount, tick } from 'svelte';
  import ConnectionStatus from './ConnectionStatus.svelte';
  import type { ConnectionState } from '../lib/SessionManager';
  import { workspaceStore } from '../lib/workspaceStore';
  import type { TabId, SplitNode } from '../lib/workspaceTypes';
  import { exitedSessions } from '../lib/exitedSessionsStore.svelte';
  import { isElectronMac } from '../lib/platformDetect';

  let {
    connectionState,
    reconnectAttempt,
    reconnectDelay,
    isLocalEchoMode,
    isLocal,
    onReconnect,
    onLogout,
  }: {
    connectionState: ConnectionState;
    reconnectAttempt: number;
    reconnectDelay: number;
    isLocalEchoMode: boolean;
    isLocal: boolean;
    onReconnect: () => void;
    onLogout: () => void;
  } = $props();

  const electronMac = isElectronMac();

  // --- Tab data from stores ---

  function collectSessionIds(node: SplitNode): string[] {
    if (!node) return [];
    if (node.type === 'pane') {
      return node.sessionId ? [node.sessionId] : [];
    }
    return (node.children || []).flatMap(collectSessionIds);
  }

  let tabExitStates = $derived((() => {
    const map = new Map<string, { exited: boolean; exitCode: number | null }>();
    const exited = exitedSessions.map;
    for (const tab of $workspaceStore.tabs) {
      const sessionIds = collectSessionIds(tab.root);
      for (const sid of sessionIds) {
        const info = exited.get(sid);
        if (info) {
          map.set(tab.id, { exited: true, exitCode: info.exitCode });
          break;
        }
      }
    }
    return map;
  })());

  // --- Tab helpers ---

  function getExitLabel(exitState: { exited: boolean; exitCode: number | null }): string {
    if (!exitState.exited) return '';
    if (exitState.exitCode !== null) return `[exited: ${exitState.exitCode}]`;
    return '[exited]';
  }

  // --- Tab state ---

  let editingTabId: TabId | null = $state(null);
  let editingName = $state('');
  let draggedTabIndex: number | null = $state(null);
  let dragOverIndex: number | null = $state(null);

  // --- Overflow detection ---

  let tabsContainerEl: HTMLDivElement | undefined = $state(undefined);
  let overflowStartIndex = $state(Infinity);

  function computeOverflow() {
    if (!tabsContainerEl) return;
    const containerRect = tabsContainerEl.getBoundingClientRect();
    const tabEls = tabsContainerEl.querySelectorAll(':scope > .tab');
    const tabs = $workspaceStore.tabs;

    let firstHidden = tabs.length;
    for (let i = 0; i < tabEls.length && i < tabs.length; i++) {
      const tabRect = tabEls[i].getBoundingClientRect();
      if (tabRect.right > containerRect.right + 1) {
        firstHidden = i;
        break;
      }
    }
    overflowStartIndex = firstHidden;
  }

  let overflowTabs = $derived($workspaceStore.tabs.slice(overflowStartIndex));
  let showOverflowMenu = $state(false);

  onMount(() => {
    if (!tabsContainerEl) return;
    const observer = new ResizeObserver(() => computeOverflow());
    observer.observe(tabsContainerEl);
    return () => observer.disconnect();
  });

  // Recompute overflow when tabs change
  $effect(() => {
    const _ = $workspaceStore.tabs.length;
    tick().then(computeOverflow);
  });

  function toggleOverflowMenu() {
    showOverflowMenu = !showOverflowMenu;
    if (showOverflowMenu) {
      setTimeout(() => {
        window.addEventListener('click', closeOverflowOnOutside, { once: true, capture: true });
      });
    }
  }

  function closeOverflowOnOutside(e: MouseEvent) {
    const wrapper = (e.target as HTMLElement)?.closest('.overflow-wrapper');
    if (!wrapper) {
      showOverflowMenu = false;
    } else {
      setTimeout(() => {
        window.addEventListener('click', closeOverflowOnOutside, { once: true, capture: true });
      });
    }
  }

  // --- Tab handlers ---

  function handleTabClick(tabId: TabId) {
    if (editingTabId !== tabId) {
      workspaceStore.setActiveTab(tabId);
    }
  }

  function handleTabClose(event: MouseEvent, tabId: TabId) {
    event.stopPropagation();
    workspaceStore.closeTab(tabId);
  }

  function handleDoubleClick(tabId: TabId, currentName: string) {
    editingTabId = tabId;
    editingName = currentName;
  }

  function handleRenameSubmit(tabId: TabId) {
    if (editingName.trim()) {
      workspaceStore.renameTab(tabId, editingName.trim());
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
    workspaceStore.createTab();
  }

  // --- Tab drag-and-drop ---

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
      workspaceStore.reorderTabs(draggedTabIndex, toIndex);
    }
    draggedTabIndex = null;
    dragOverIndex = null;
  }

  function handleDragEnd() {
    draggedTabIndex = null;
    dragOverIndex = null;
  }

</script>

<div class="title-bar" class:electron-mac={electronMac}>
  <!-- Connection status (compact) -->
  {#if isLocalEchoMode}
    <div class="local-echo-dot" title="LOCAL PTY MODE - Main Server Bypassed"></div>
  {:else if connectionState !== 'connected'}
    <div class="connection-dot-wrapper">
      <ConnectionStatus
        state={connectionState}
        {reconnectAttempt}
        {reconnectDelay}
        onReconnect={onReconnect}
      />
    </div>
  {/if}

  <!-- Tabs -->
  <div class="tabs-container" bind:this={tabsContainerEl}>
    {#each $workspaceStore.tabs as tab, index}
      <div
        class="tab"
        class:active={tab.id === $workspaceStore.activeTabId}
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
        aria-selected={tab.id === $workspaceStore.activeTabId}
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
        {#if tabExitStates.has(tab.id) && tabExitStates.get(tab.id)!.exited}
          <span class="exit-badge">{getExitLabel(tabExitStates.get(tab.id)!)}</span>
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

  <!-- Overflow dropdown for hidden tabs -->
  {#if overflowTabs.length > 0}
    <div class="overflow-wrapper">
      <button class="overflow-btn" onclick={toggleOverflowMenu} aria-label="More tabs">
        +{overflowTabs.length}
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path d="M2 4 L5 7 L8 4" stroke="currentColor" stroke-width="1.5" fill="none"/>
        </svg>
      </button>
      {#if showOverflowMenu}
        <div class="overflow-menu">
          {#each overflowTabs as tab}
            <div
              class="overflow-item"
              class:active={tab.id === $workspaceStore.activeTabId}
              onclick={() => { handleTabClick(tab.id); showOverflowMenu = false; }}
              role="menuitem"
              tabindex="0"
            >
              <span class="overflow-item-name">{tab.name}</span>
              <button
                class="overflow-item-close"
                onclick={(e) => { e.stopPropagation(); workspaceStore.closeTab(tab.id); }}
                aria-label="Close tab"
              >
                <svg width="10" height="10" viewBox="0 0 12 12">
                  <path d="M2 2 L10 10 M10 2 L2 10" stroke="currentColor" stroke-width="1.5" fill="none"/>
                </svg>
              </button>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  <button class="new-tab-button" onclick={handleCreateTab} aria-label="New tab">
    <svg width="14" height="14" viewBox="0 0 14 14">
      <path d="M7 2 L7 12 M2 7 L12 7" stroke="currentColor" stroke-width="1.5" fill="none"/>
    </svg>
  </button>

  <!-- Draggable spacer -->
  <div class="drag-spacer"></div>

  <!-- Toolbar buttons -->
  <div class="toolbar-buttons">
    {#if !isLocal}
      <button
        class="logout-btn"
        onclick={onLogout}
        title="Logout"
        aria-label="Logout and disconnect"
      >Logout</button>
    {/if}
    <h3 class="app-title">terminar</h3>
  </div>
</div>

<style>
  .title-bar {
    zoom: var(--controls-zoom, 1);
    display: flex;
    align-items: center;
    height: 38px;
    background: var(--ui-bg-primary, #0d0e10);
    border-bottom: 1px solid var(--ui-border, #47484a);
    padding: 0 8px 0 8px;
    gap: 0;
    user-select: none;
    flex-shrink: 0;
    -webkit-app-region: drag;
  }

  .title-bar.electron-mac {
    padding-left: 76px;
  }

  .title-bar :global(button),
  .title-bar :global(input),
  .title-bar .tab,
  .title-bar .new-tab-button,
  .title-bar .connection-dot-wrapper {
    -webkit-app-region: no-drag;
  }

  /* Connection status */
  .local-echo-dot {
    width: 8px;
    height: 8px;
    background: #e5c07b;
    border-radius: 50%;
    flex-shrink: 0;
    margin-right: 8px;
    animation: pulse 2s ease-in-out infinite;
  }

  .connection-dot-wrapper {
    flex-shrink: 0;
    margin-right: 4px;
  }

  /* Tabs */
  .tabs-container {
    display: flex;
    overflow: hidden;
    gap: 2px;
    min-width: 0;
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
    -webkit-app-region: no-drag;
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
    flex-shrink: 0;
    margin-left: 4px;
  }

  .new-tab-button:hover {
    background: var(--ui-bg-tertiary, #242629);
    color: var(--ui-text-primary, #fdfbfe);
  }

  /* Overflow dropdown */
  .overflow-wrapper {
    position: relative;
    flex-shrink: 0;
    margin-left: 4px;
    -webkit-app-region: no-drag;
  }

  .overflow-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: var(--ui-text-muted, #757578);
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    transition: all 0.15s;
  }

  .overflow-btn:hover {
    background: var(--ui-bg-tertiary, #242629);
    color: var(--ui-text-primary, #fdfbfe);
  }

  .overflow-menu {
    position: absolute;
    top: 100%;
    left: 0;
    margin-top: 4px;
    background: var(--ui-bg-secondary, #181a1c);
    border: 1px solid var(--ui-border, #47484a);
    border-radius: 6px;
    padding: 4px;
    min-width: 160px;
    max-width: 240px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    z-index: 1000;
    animation: fadeIn 0.15s ease-out;
    -webkit-app-region: no-drag;
  }

  .overflow-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: var(--ui-text-secondary, #ababad);
    cursor: pointer;
    font-size: 13px;
    text-align: left;
    transition: background 0.1s;
  }

  .overflow-item:hover {
    background: var(--ui-bg-tertiary, #242629);
    color: var(--ui-text-primary, #fdfbfe);
  }

  .overflow-item.active {
    color: var(--ui-accent, #a0a7ff);
  }

  .overflow-item-name {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .overflow-item-close {
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
    flex-shrink: 0;
    transition: opacity 0.1s;
  }

  .overflow-item:hover .overflow-item-close {
    opacity: 1;
  }

  .overflow-item-close:hover {
    background: rgba(255, 255, 255, 0.1);
    color: var(--ui-text-primary, #fdfbfe);
  }

  /* Draggable spacer between tabs and toolbar */
  .drag-spacer {
    flex: 1 1 auto;
    min-width: 16px;
  }

  /* Toolbar buttons */
  .toolbar-buttons {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .app-title {
    margin: 0 10px 0 0;
    font-size: 16px;
    font-weight: 600;
    letter-spacing: 0.5px;
    color: var(--ui-text-primary, #fdfbfe);
  }

  .logout-btn {
    padding: 4px 10px;
    background: transparent;
    border: 1px solid var(--ui-border, #555);
    border-radius: 4px;
    color: var(--ui-text-muted, #757578);
    cursor: pointer;
    font-size: 12px;
    transition: all 0.15s;
  }

  .logout-btn:hover {
    background: var(--ui-bg-tertiary, #242629);
    color: var(--ui-destructive, #ff6b6b);
    border-color: var(--ui-destructive, #ff6b6b);
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

</style>
