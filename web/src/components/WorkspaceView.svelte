<script lang="ts">
  import TabBar from './TabBar.svelte';
  import SplitContainer from './SplitContainer.svelte';
  import ContextMenu from './ContextMenu.svelte';
  import { workspaceStore, activeTab } from '../lib/workspaceStore';
  import { getPane } from '../lib/paneRegistry';
  import { setTerminalOverride } from '../lib/themeStore';
  import { BUILT_IN_TERMINAL_THEMES } from '../lib/themeTypes';
  import type { TabId, PaneId, SessionId, DropZone, SplitDirection, SplitNode } from '../lib/workspaceTypes';
  import { findPane } from '../lib/workspaceTypes';
  import { activityStore } from '../lib/activityStore';
  import { exitedSessions } from '../lib/exitedSessionsStore';

  import { getManagerContext, getSessionsContext, getActionsContext } from '../lib/sessionContext';
  import type { SessionManager } from '../lib/SessionManager';

  // Optional prop overrides (for tests that render without context)
  export let manager: SessionManager | null | undefined = undefined;
  export let availableSessions: { id: string; name?: string }[] | undefined = undefined;

  const managerStore = getManagerContext();
  const sessionsStore = getSessionsContext();
  const actions = getActionsContext();

  // Use prop override if provided, otherwise read from context
  $: effectiveManager = manager !== undefined ? manager : $managerStore;
  $: effectiveAvailableSessions = availableSessions !== undefined ? availableSessions : $sessionsStore.map(s => ({ id: s.id, name: s.name }));

  // Helper: collect all sessionIds from a split tree
  function collectSessionIds(node: SplitNode): string[] {
    if (!node) return [];
    if (node.type === 'pane') {
      return node.sessionId ? [node.sessionId] : [];
    }
    return (node.children || []).flatMap(collectSessionIds);
  }

  // Compute tab indicator maps from stores (reactive)
  $: tabActivities = (() => {
    const map = new Map<string, string>();
    const activities = $activityStore.activities;
    for (const tab of $workspaceStore.tabs) {
      if (tab.id === $workspaceStore.activeTabId) continue; // skip active tab
      const sessionIds = collectSessionIds(tab.root);
      for (const sid of sessionIds) {
        const activity = activities.get(sid);
        if (activity) {
          map.set(tab.id, activity);
          break; // one indicator per tab is enough
        }
      }
    }
    return map;
  })();

  $: tabExitStates = (() => {
    const map = new Map<string, { exited: boolean; exitCode: number | null }>();
    const exited = $exitedSessions;
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
  })();

  // tabAgents no longer displayed in tabs — pass empty map for prop compat
  $: tabAgents = new Map<string, { icon: string; color: string; displayName: string }>();

  let activePaneId: PaneId | null = null;
  let contextMenu: { x: number; y: number; paneId: string } | null = null;
  let clipboardText: string = '';

  // Handle tab events
  function handleTabSelect(event: CustomEvent<{ tabId: TabId }>) {
    workspaceStore.setActiveTab(event.detail.tabId);
  }

  function handleTabClose(event: CustomEvent<{ tabId: TabId }>) {
    workspaceStore.closeTab(event.detail.tabId);
  }

  function handleTabCreate() {
    workspaceStore.createTab();
  }

  function handleTabRename(event: CustomEvent<{ tabId: TabId; name: string }>) {
    workspaceStore.renameTab(event.detail.tabId, event.detail.name);
  }

  function handleTabReorder(event: CustomEvent<{ fromIndex: number; toIndex: number }>) {
    workspaceStore.reorderTabs(event.detail.fromIndex, event.detail.toIndex);
  }

  // Handle split container events
  function handleDrop(event: CustomEvent<{ paneId: string; sessionId: SessionId; dropZone: DropZone }>) {
    const { paneId, sessionId, dropZone } = event.detail;
    workspaceStore.handleDrop(paneId, sessionId, dropZone);
  }

  function handlePaneContextMenu(event: CustomEvent<{ paneId: string; x: number; y: number }>) {
    contextMenu = event.detail;
    // Read clipboard eagerly while we still have user activation from the right-click.
    // navigator.clipboard.readText() requires transient activation which expires
    // by the time a menu item click handler fires.
    navigator.clipboard.readText().then((text) => {
      clipboardText = text;
    }).catch(() => {
      clipboardText = '';
    });
  }

  function handlePaneFocus(event: CustomEvent<{ paneId: string }>) {
    activePaneId = event.detail.paneId;
  }

  function handleResize(event: CustomEvent<{ splitId: string; ratios: number[] }>) {
    workspaceStore.updateRatios(event.detail.splitId, event.detail.ratios);
  }

  function handleDetach(event: CustomEvent<{ paneId: string }>) {
    workspaceStore.closePane(event.detail.paneId);
  }

  function handleKill(event: CustomEvent<{ paneId: string; sessionId: string }>) {
    const { paneId, sessionId } = event.detail;
    if (effectiveManager) {
      effectiveManager.killSession(sessionId);
    }
    workspaceStore.closePane(paneId);
  }

  function handleActionPaneClose(event: CustomEvent<{ paneId: string }>) {
    workspaceStore.closePane(event.detail.paneId);
  }

  function handleActionSplitHorizontal(event: CustomEvent<{ paneId: string }>) {
    workspaceStore.splitPane(event.detail.paneId, 'horizontal');
  }

  function handleActionSplitVertical(event: CustomEvent<{ paneId: string }>) {
    workspaceStore.splitPane(event.detail.paneId, 'vertical');
  }

  // Context menu actions
  function handleContextMenuClose() {
    contextMenu = null;
  }

  function handleSplitLeft() {
    if (contextMenu) {
      workspaceStore.splitPaneBefore(contextMenu.paneId, 'horizontal');
      contextMenu = null;
    }
  }

  function handleSplitHorizontal() {
    if (contextMenu) {
      workspaceStore.splitPane(contextMenu.paneId, 'horizontal');
      contextMenu = null;
    }
  }

  function handleSplitUp() {
    if (contextMenu) {
      workspaceStore.splitPaneBefore(contextMenu.paneId, 'vertical');
      contextMenu = null;
    }
  }

  function handleSplitVertical() {
    if (contextMenu) {
      workspaceStore.splitPane(contextMenu.paneId, 'vertical');
      contextMenu = null;
    }
  }

  function handleClosePane() {
    if (contextMenu) {
      workspaceStore.closePane(contextMenu.paneId);
      contextMenu = null;
    }
  }

  function handleAssignSession(sessionId: SessionId) {
    if (contextMenu) {
      workspaceStore.assignSession(contextMenu.paneId, sessionId);
      contextMenu = null;
    }
  }

  function handleCopy() {
    if (contextMenu) {
      const pane = getPane(contextMenu.paneId);
      if (pane) {
        const text = pane.getSelection();
        if (text) {
          navigator.clipboard.writeText(text);
        }
      }
      contextMenu = null;
    }
  }

  function handlePaste() {
    if (contextMenu) {
      const paneId = contextMenu.paneId;
      contextMenu = null;
      if (clipboardText) {
        const pane = getPane(paneId);
        pane?.pasteText(clipboardText);
      }
    }
  }

  function handleSelectAll() {
    if (contextMenu) {
      const pane = getPane(contextMenu.paneId);
      pane?.selectAll();
      contextMenu = null;
    }
  }

  function handleRefresh() {
    if (contextMenu) {
      const pane = getPane(contextMenu.paneId);
      pane?.refreshTerminal?.();
      contextMenu = null;
    }
  }

  function handleRename() {
    if (contextMenu) {
      const tab = $workspaceStore.tabs.find(t => t.id === $workspaceStore.activeTabId);
      if (!tab) { contextMenu = null; return; }
      const pane = findPane(tab.root, contextMenu.paneId);
      if (!pane?.sessionId) { contextMenu = null; return; }
      const session = effectiveAvailableSessions.find(s => s.id === pane.sessionId);
      const currentName = session?.name || '';
      const newName = prompt('Rename session:', currentName);
      if (newName !== null && newName !== currentName) {
        actions.renameTerminal(pane.sessionId, newName);
      }
      contextMenu = null;
    }
  }

  function handleClearPane() {
    if (contextMenu) {
      workspaceStore.assignSession(contextMenu.paneId, null);
      contextMenu = null;
    }
  }

  function handleSetTerminalTheme(themeId: string) {
    if (contextMenu) {
      setTerminalOverride(contextMenu.paneId, themeId);
      contextMenu = null;
    }
  }

  // Keyboard shortcuts
  function handleKeydown(event: KeyboardEvent) {
    // Cmd/Ctrl + Shift + E = Split horizontal
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key === 'e') {
      event.preventDefault();
      if (activePaneId) {
        workspaceStore.splitPane(activePaneId, 'horizontal');
      }
    }
    // Cmd/Ctrl + Shift + O = Split vertical
    else if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key === 'o') {
      event.preventDefault();
      if (activePaneId) {
        workspaceStore.splitPane(activePaneId, 'vertical');
      }
    }
    // Cmd/Ctrl + W = Close pane
    else if ((event.metaKey || event.ctrlKey) && event.key === 'w') {
      event.preventDefault();
      if (activePaneId) {
        workspaceStore.closePane(activePaneId);
      }
    }
    // Cmd/Ctrl + T = New tab
    else if ((event.metaKey || event.ctrlKey) && event.key === 't') {
      event.preventDefault();
      workspaceStore.createTab();
    }
    // Cmd/Ctrl + 1-9 = Switch to tab
    else if ((event.metaKey || event.ctrlKey) && event.key >= '1' && event.key <= '9') {
      event.preventDefault();
      const index = parseInt(event.key) - 1;
      const ws = workspaceStore.get();
      if (index < ws.tabs.length) {
        workspaceStore.setActiveTab(ws.tabs[index].id);
      }
    }
  }

  // Build context menu items
  $: contextMenuItems = contextMenu ? [
    { label: 'Copy', action: handleCopy, shortcut: 'Cmd+C' },
    { label: 'Paste', action: handlePaste, shortcut: 'Cmd+V' },
    { label: 'Select All', action: handleSelectAll, shortcut: 'Cmd+A' },
    { type: 'separator' as const },
    { label: 'Refresh', action: handleRefresh },
    { label: 'Rename', action: handleRename },
    { type: 'separator' as const },
    { label: 'Split', action: () => {}, children: [
      { label: 'Split Left', action: handleSplitLeft },
      { label: 'Split Right', action: handleSplitHorizontal, shortcut: 'Cmd+Shift+E' },
      { label: 'Split Up', action: handleSplitUp },
      { label: 'Split Down', action: handleSplitVertical, shortcut: 'Cmd+Shift+O' },
    ]},
    ...(effectiveAvailableSessions.length > 0 ? [
      { label: 'Assign Session', action: () => {}, children: effectiveAvailableSessions.map(session => ({
        label: session.name || session.id.slice(0, 8),
        action: () => handleAssignSession(session.id),
      }))},
    ] : []),
    { label: 'Theme', action: () => {}, children: BUILT_IN_TERMINAL_THEMES.map(theme => ({
      label: theme.name,
      action: () => handleSetTerminalTheme(theme.id),
    }))},
    { type: 'separator' as const },
    { label: 'Clear Pane', action: handleClearPane },
    { label: 'Close Pane', action: handleClosePane, shortcut: 'Cmd+W' },
  ] : [];
</script>

<svelte:window on:keydown={handleKeydown} />

<div class="workspace-view">
  <TabBar
    tabs={$workspaceStore.tabs}
    activeTabId={$workspaceStore.activeTabId}
    {tabActivities}
    {tabExitStates}
    {tabAgents}
    on:select={handleTabSelect}
    on:close={handleTabClose}
    on:create={handleTabCreate}
    on:rename={handleTabRename}
    on:reorder={handleTabReorder}
  />

  <div class="workspace-content">
    {#if $activeTab}
      <SplitContainer
        node={$activeTab.root}
        {activePaneId}
        on:drop={handleDrop}
        on:contextmenu={handlePaneContextMenu}
        on:focus={handlePaneFocus}
        on:resize={handleResize}
        on:detach={handleDetach}
        on:kill={handleKill}
        on:action:pane.close={handleActionPaneClose}
        on:action:split.horizontal={handleActionSplitHorizontal}
        on:action:split.vertical={handleActionSplitVertical}
      />
    {:else}
      <div class="no-tab">
        <p>No tab selected</p>
        <button on:click={handleTabCreate}>Create Tab</button>
      </div>
    {/if}
  </div>

  {#if contextMenu}
    <ContextMenu
      x={contextMenu.x}
      y={contextMenu.y}
      items={contextMenuItems}
      on:close={handleContextMenuClose}
    />
  {/if}
</div>

<style>
  .workspace-view {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  .workspace-content {
    flex: 1;
    overflow: hidden;
  }

  .no-tab {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--ui-text-muted, #888);
    gap: 16px;
  }

  .no-tab button {
    padding: 8px 16px;
    background: var(--ui-accent, #0e639c);
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
  }

  .no-tab button:hover {
    background: var(--ui-accent-hover, #1177bb);
  }
</style>
