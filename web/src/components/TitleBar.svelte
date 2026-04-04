<script lang="ts">
  import { onMount, tick } from 'svelte';
  import ConnectionStatus from './ConnectionStatus.svelte';
  import type { ConnectionState } from '../lib/SessionManager';
  import { broadcastEnabled, clearTargets } from '../lib/broadcastStore.svelte';
  import { workspaceStore } from '../lib/workspaceStore';
  import type { TabId, SplitNode } from '../lib/workspaceTypes';
  import { activityStore } from '../lib/activityStore.svelte';
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
    onSettings,
    onToggleBroadcast,
  }: {
    connectionState: ConnectionState;
    reconnectAttempt: number;
    reconnectDelay: number;
    isLocalEchoMode: boolean;
    isLocal: boolean;
    onReconnect: () => void;
    onLogout: () => void;
    onSettings: () => void;
    onToggleBroadcast: () => void;
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

  let tabActivities = $derived((() => {
    const map = new Map<string, string>();
    const activities = activityStore.activities;
    for (const tab of $workspaceStore.tabs) {
      if (tab.id === $workspaceStore.activeTabId) continue;
      const sessionIds = collectSessionIds(tab.root);
      for (const sid of sessionIds) {
        const activity = activities.get(sid);
        if (activity) {
          map.set(tab.id, activity);
          break;
        }
      }
    }
    return map;
  })());

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

  function getActivityIcon(activityType: string): string {
    switch (activityType) {
      case 'bell': return '\u{1F514}';
      case 'silence': return '\u{1F4A4}';
      default: return '\u{25CF}';
    }
  }

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

  // --- Shortcuts popup ---

  let showShortcutsPopup = $state(false);
  let shortcutsTimeout: ReturnType<typeof setTimeout> | null = null;

  function toggleShortcuts() {
    if (shortcutsTimeout) {
      clearTimeout(shortcutsTimeout);
      shortcutsTimeout = null;
    }
    showShortcutsPopup = !showShortcutsPopup;
    if (showShortcutsPopup) {
      shortcutsTimeout = setTimeout(() => {
        showShortcutsPopup = false;
        shortcutsTimeout = null;
      }, 8000);
      setTimeout(() => {
        window.addEventListener('click', closeShortcutsOnOutsideClick, { once: true, capture: true });
      });
    }
  }

  function closeShortcutsOnOutsideClick(e: MouseEvent) {
    const wrapper = (e.target as HTMLElement)?.closest('.shortcuts-wrapper');
    if (!wrapper) {
      showShortcutsPopup = false;
      if (shortcutsTimeout) {
        clearTimeout(shortcutsTimeout);
        shortcutsTimeout = null;
      }
    } else {
      setTimeout(() => {
        window.addEventListener('click', closeShortcutsOnOutsideClick, { once: true, capture: true });
      });
    }
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
        {#if tabActivities.has(tab.id) && tab.id !== $workspaceStore.activeTabId && tabActivities.get(tab.id) !== 'silence'}
          <span class="activity-badge">{getActivityIcon(tabActivities.get(tab.id)!)}</span>
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
    <div class="shortcuts-wrapper">
      <button
        class="icon-btn"
        onclick={toggleShortcuts}
        title="Keyboard Shortcuts"
        aria-label="Show keyboard shortcuts"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M1 4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4zm1 0v8h12V4H2zm1.5 1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-1 0v-1a.5.5 0 0 1 .5-.5zm2 0a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-1 0v-1a.5.5 0 0 1 .5-.5zm2 0a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-1 0v-1a.5.5 0 0 1 .5-.5zm2 0a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-1 0v-1a.5.5 0 0 1 .5-.5zm2 0a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-1 0v-1a.5.5 0 0 1 .5-.5zM3.5 8a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-1 0v-1a.5.5 0 0 1 .5-.5zm8 0a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-1 0v-1a.5.5 0 0 1 .5-.5zm-6 0h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1 0-1z"/>
        </svg>
      </button>
      {#if showShortcutsPopup}
        <div class="shortcuts-popup">
          <div class="shortcuts-title">Keyboard Shortcuts</div>
          <div class="shortcut-row"><kbd>Ctrl/Cmd+F</kbd> <span>Search in terminal</span></div>
          <div class="shortcut-row"><kbd>Escape</kbd> <span>Close search</span></div>
          <div class="shortcut-row"><kbd>Cmd+B</kbd> <span>Toggle sidebar</span></div>
          <div class="shortcut-row"><kbd>Cmd+Shift+N</kbd> <span>New terminal</span></div>
          <div class="shortcut-row"><kbd>Cmd+T</kbd> <span>New tab</span></div>
          <div class="shortcut-row"><kbd>Cmd+W</kbd> <span>Close pane</span></div>
          <div class="shortcut-row"><kbd>Ctrl+Shift+H</kbd> <span>Split horizontal</span></div>
          <div class="shortcut-row"><kbd>Ctrl+Shift+V</kbd> <span>Split vertical</span></div>
          <div class="shortcut-row"><kbd>Cmd+1-9</kbd> <span>Switch tab</span></div>
        </div>
      {/if}
    </div>
    <button
      class="icon-btn"
      class:active={broadcastEnabled.value}
      onclick={onToggleBroadcast}
      title="Broadcast Mode"
      aria-label="Toggle broadcast mode"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 1a.5.5 0 0 1 .5.5v1.527A6.5 6.5 0 0 1 14.5 9.5a.5.5 0 0 1-1 0 5.5 5.5 0 0 0-5-5.478V5.5a.5.5 0 0 1-1 0V4.022A5.5 5.5 0 0 0 2.5 9.5a.5.5 0 0 1-1 0A6.5 6.5 0 0 1 7.5 3.027V1.5A.5.5 0 0 1 8 1zM5.5 9.5a2.5 2.5 0 1 1 5 0 2.5 2.5 0 0 1-5 0zm1 0a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0zM4 9.5a4 4 0 0 1 4-4 .5.5 0 0 1 0 1 3 3 0 0 0-3 3 .5.5 0 0 1-1 0zm7 0a3 3 0 0 0-3-3 .5.5 0 0 1 0-1 4 4 0 0 1 4 4 .5.5 0 0 1-1 0z"/>
      </svg>
    </button>
    {#if !isLocal}
      <button
        class="logout-btn"
        onclick={onLogout}
        title="Logout"
        aria-label="Logout and disconnect"
      >Logout</button>
    {/if}
    <button
      class="icon-btn"
      onclick={onSettings}
      title="Terminal Settings"
      aria-label="Open terminal settings"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path fill-rule="evenodd" clip-rule="evenodd" d="M9.1 4.4L8.6 2H7.4L6.9 4.4L6.5 4.6L4.4 3.5L3.5 4.4L4.6 6.5L4.4 6.9L2 7.4V8.6L4.4 9.1L4.6 9.5L3.5 11.6L4.4 12.5L6.5 11.4L6.9 11.6L7.4 14H8.6L9.1 11.6L9.5 11.4L11.6 12.5L12.5 11.6L11.4 9.5L11.6 9.1L14 8.6V7.4L11.6 6.9L11.4 6.5L12.5 4.4L11.6 3.5L9.5 4.6L9.1 4.4ZM8 10C9.1046 10 10 9.1046 10 8C10 6.8954 9.1046 6 8 6C6.8954 6 6 6.8954 6 8C6 9.1046 6.8954 10 8 10Z"/>
      </svg>
    </button>
  </div>
</div>

<style>
  .title-bar {
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
    flex: 1;
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
    border-bottom-color: var(--ui-accent, #a0a7ff);
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
    color: var(--ui-accent, #a0a7ff);
  }

  .activity-badge {
    font-size: 10px;
    line-height: 1;
    flex-shrink: 0;
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
    flex: 0 0 auto;
    min-width: 16px;
  }

  /* Toolbar buttons */
  .toolbar-buttons {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .shortcuts-wrapper {
    position: relative;
  }

  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: var(--ui-text-muted, #757578);
    cursor: pointer;
    transition: all 0.15s;
  }

  .icon-btn:hover {
    background: var(--ui-bg-tertiary, #242629);
    color: var(--ui-text-primary, #fdfbfe);
  }

  .icon-btn.active {
    color: var(--ui-accent, #a0a7ff);
    background: rgba(14, 99, 156, 0.15);
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

  .shortcuts-popup {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 6px;
    background: var(--ui-bg-secondary, #181a1c);
    border: 1px solid var(--ui-border, #47484a);
    border-radius: 6px;
    padding: 10px 14px;
    min-width: 240px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    z-index: 1000;
    animation: fadeIn 0.15s ease-out;
    -webkit-app-region: no-drag;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  .shortcuts-title {
    font-size: 11px;
    font-weight: 600;
    color: var(--ui-text-secondary, #aaa);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 8px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--ui-border, #47484a);
  }

  .shortcut-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 3px 0;
    font-size: 12px;
    color: var(--ui-text-primary, #fdfbfe);
  }

  .shortcut-row kbd {
    font-family: inherit;
    font-size: 11px;
    color: var(--ui-text-primary, #ddd);
    background: var(--ui-bg-tertiary, #242629);
    border: 1px solid var(--ui-border, #505050);
    border-radius: 3px;
    padding: 1px 6px;
    min-width: 0;
  }

  .shortcut-row span {
    color: var(--ui-text-muted, #757578);
    margin-left: 16px;
  }
</style>
