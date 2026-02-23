<script lang="ts">
  import TabBar from './TabBar.svelte';
  import SplitContainer from './SplitContainer.svelte';
  import ContextMenu from './ContextMenu.svelte';
  import { workspaceStore, activeTab } from '../lib/workspaceStore';
  import { getPane } from '../lib/paneRegistry';
  import { setTerminalOverride } from '../lib/themeStore.svelte';
  import { BUILT_IN_TERMINAL_THEMES } from '../lib/themeTypes';
  import type { TabId, PaneId, SessionId, SplitNode } from '../lib/workspaceTypes';
  import { findPane } from '../lib/workspaceTypes';
  import { activityStore } from '../lib/activityStore.svelte';
  import { exitedSessions } from '../lib/exitedSessionsStore.svelte';

  import { fade } from 'svelte/transition';
  import { focusedPane } from '../lib/focusStore.svelte';
  import { getManagerContext, getSessionsContext, getActionsContext, setPaneActionsContext } from '../lib/sessionContext.svelte';
  import type { SessionManager } from '../lib/SessionManager';

  // Optional prop overrides (for tests that render without context)
  let {
    manager = undefined,
    availableSessions = undefined,
  }: {
    manager?: SessionManager | null;
    availableSessions?: { id: string; name?: string }[];
  } = $props();

  const managerBox = getManagerContext();
  const sessionsBox = getSessionsContext();
  const actions = getActionsContext();

  // Use prop override if provided, otherwise read from context
  let effectiveManager = $derived(manager !== undefined ? manager : managerBox.value);
  let effectiveAvailableSessions = $derived(availableSessions !== undefined ? availableSessions : sessionsBox.value.map(s => ({ id: s.id, name: s.name })));

  // Helper: collect all sessionIds from a split tree
  function collectSessionIds(node: SplitNode): string[] {
    if (!node) return [];
    if (node.type === 'pane') {
      return node.sessionId ? [node.sessionId] : [];
    }
    return (node.children || []).flatMap(collectSessionIds);
  }

  // Compute tab indicator maps from stores (reactive)
  let tabActivities = $derived((() => {
    const map = new Map<string, string>();
    const activities = activityStore.activities;
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

  // tabAgents no longer displayed in tabs -- pass empty map for prop compat
  let tabAgents = $derived(new Map<string, { icon: string; color: string; displayName: string }>());

  let activePaneId = $state<PaneId | null>(null);
  let contextMenu = $state<{ x: number; y: number; paneId: string } | null>(null);
  let clipboardText = $state('');

  // Handle tab events
  function handleTabSelect(detail: { tabId: TabId }) {
    workspaceStore.setActiveTab(detail.tabId);
  }

  function handleTabClose(detail: { tabId: TabId }) {
    workspaceStore.closeTab(detail.tabId);
  }

  function handleTabCreate() {
    workspaceStore.createTab();
  }

  function handleTabRename(detail: { tabId: TabId; name: string }) {
    workspaceStore.renameTab(detail.tabId, detail.name);
  }

  function handleTabReorder(detail: { fromIndex: number; toIndex: number }) {
    workspaceStore.reorderTabs(detail.fromIndex, detail.toIndex);
  }

  // Set up PaneActions context — dispatches from Pane/SplitContainer without prop threading
  setPaneActionsContext({
    drop(paneId, sessionId, dropZone) { workspaceStore.handleDrop(paneId, sessionId, dropZone); },
    paneDrop(src, tgt, zone) { workspaceStore.movePane(src, tgt, zone); },
    contextMenu(paneId, x, y) {
      contextMenu = { paneId, x, y };
      // Read clipboard eagerly while we still have user activation from the right-click.
      // navigator.clipboard.readText() requires transient activation which expires
      // by the time a menu item click handler fires.
      navigator.clipboard.readText().then((text) => {
        clipboardText = text;
      }).catch(() => {
        clipboardText = '';
      });
    },
    focus(paneId) { activePaneId = paneId; },
    detach(paneId) { workspaceStore.closePane(paneId); },
    kill(paneId, sessionId) {
      if (effectiveManager) {
        effectiveManager.killSession(sessionId);
      }
      workspaceStore.closePane(paneId);
    },
    closePaneAction(paneId) { focusedPane.id = null; workspaceStore.closePane(paneId); },
    splitHorizontal(paneId) { focusedPane.id = null; workspaceStore.splitPane(paneId, 'horizontal'); },
    splitVertical(paneId) { focusedPane.id = null; workspaceStore.splitPane(paneId, 'vertical'); },
    commitResize(splitId, ratios) { workspaceStore.updateRatios(splitId, ratios); },
    toggleFocus(paneId) { focusedPane.id = focusedPane.id === paneId ? null : paneId; },
  });

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

  function handleNewTerminalInPane() {
    if (contextMenu) {
      actions.createNewTerminal(contextMenu.paneId);
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

  function handleFocusPane() {
    if (contextMenu) {
      focusedPane.id = contextMenu.paneId;
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

  function handleResetTerminal() {
    if (!contextMenu) return;
    const tab = $workspaceStore.tabs.find(t => t.id === $workspaceStore.activeTabId);
    if (!tab) { contextMenu = null; return; }
    const pane = findPane(tab.root, contextMenu.paneId);
    if (!pane?.sessionId) { contextMenu = null; return; }
    const confirmed = window.confirm('Reset this terminal?\n\nThis will end the current session and start a fresh one in the same directory.');
    if (!confirmed) { contextMenu = null; return; }
    actions.resetTerminal(pane.sessionId, contextMenu.paneId);
    contextMenu = null;
  }

  function handleSetTerminalTheme(themeId: string) {
    if (contextMenu) {
      setTerminalOverride(contextMenu.paneId, themeId);
      contextMenu = null;
    }
  }

  // Keyboard shortcuts
  function handleKeydown(event: KeyboardEvent) {
    // Escape dismisses focus overlay
    if (event.key === 'Escape' && focusedPane.id) {
      event.preventDefault();
      focusedPane.id = null;
      return;
    }
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
  let contextMenuItems = $derived(contextMenu ? [
    { label: 'Copy', action: handleCopy, shortcut: 'Cmd+C' },
    { label: 'Paste', action: handlePaste, shortcut: 'Cmd+V' },
    { label: 'Select All', action: handleSelectAll, shortcut: 'Cmd+A' },
    { type: 'separator' as const },
    { label: 'Refresh', action: handleRefresh },
    { label: 'Focus Pane', action: handleFocusPane, shortcut: 'Cmd+Shift+F' },
    { label: 'Rename', action: handleRename },
    { type: 'separator' as const },
    { label: 'Split', action: () => {}, children: [
      { label: 'Split Left', action: handleSplitLeft },
      { label: 'Split Right', action: handleSplitHorizontal, shortcut: 'Cmd+Shift+E' },
      { label: 'Split Up', action: handleSplitUp },
      { label: 'Split Down', action: handleSplitVertical, shortcut: 'Cmd+Shift+O' },
    ]},
    { label: 'Attach Session', action: () => {}, children: [
      { label: 'New Terminal', action: handleNewTerminalInPane },
      ...(effectiveAvailableSessions.length > 0 ? [{ type: 'separator' as const }] : []),
      ...effectiveAvailableSessions.map(session => ({
        label: session.name || session.id.slice(0, 8),
        action: () => handleAssignSession(session.id),
      })),
    ]},
    { label: 'Theme', action: () => {}, children: BUILT_IN_TERMINAL_THEMES.map(theme => ({
      label: theme.name,
      action: () => handleSetTerminalTheme(theme.id),
    }))},
    { type: 'separator' as const },
    { label: 'Clear Pane', action: handleClearPane },
    { label: 'Close Pane', action: handleClosePane, shortcut: 'Cmd+W' },
    { type: 'separator' as const },
    { label: 'Reset Terminal', action: handleResetTerminal },
  ] : []);
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="workspace-view">
  <TabBar
    tabs={$workspaceStore.tabs}
    activeTabId={$workspaceStore.activeTabId}
    {tabActivities}
    {tabExitStates}
    {tabAgents}
    onselect={(detail) => handleTabSelect(detail)}
    onclose={(detail) => handleTabClose(detail)}
    oncreate={() => handleTabCreate()}
    onrename={(detail) => handleTabRename(detail)}
    onreorder={(detail) => handleTabReorder(detail)}
  />

  <div class="workspace-content">
    {#if $activeTab}
      <SplitContainer
        node={$activeTab.root}
        {activePaneId}
      />
    {:else}
      <div class="no-tab">
        <p>No tab selected</p>
        <button onclick={handleTabCreate}>Create Tab</button>
      </div>
    {/if}

    {#if focusedPane.id}
      <div class="focus-backdrop" transition:fade={{ duration: 200 }} onclick={() => focusedPane.id = null} role="presentation"></div>
    {/if}
  </div>

  {#if contextMenu}
    <ContextMenu
      x={contextMenu.x}
      y={contextMenu.y}
      items={contextMenuItems}
      onclose={() => handleContextMenuClose()}
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
    position: relative;
  }

  .focus-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 49;
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
