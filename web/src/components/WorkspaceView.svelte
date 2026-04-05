<script lang="ts">
  import SplitContainer from './SplitContainer.svelte';
  import ContextMenu from './ContextMenu.svelte';
  import { workspaceStore, activeTab } from '../lib/workspaceStore';
  import { getPane } from '../lib/paneRegistry';
  import { setTerminalOverride } from '../lib/themeStore.svelte';
  import { BUILT_IN_TERMINAL_THEMES } from '../lib/themeTypes';
  import type { PaneId, SessionId } from '../lib/workspaceTypes';
  import { findPane } from '../lib/workspaceTypes';

  import { fade } from 'svelte/transition';
  import { focusedPane } from '../lib/focusStore.svelte';
  import { activePaneStore } from '../lib/activePaneStore.svelte';
  import { getManagerContext, getSessionsContext, getActionsContext, setPaneActionsContext } from '../lib/sessionContext.svelte';
  import type { SessionManager } from '../lib/SessionManager';
  import { sessionCwdStore } from '../lib/sessionCwdStore.svelte';
  import { settingsStore, getTitleBarFields, setTitleBarFieldVisible, clearTitleBarOverride, hasTitleBarOverride, titleBarOverridesState, TITLE_BAR_FIELD_LABELS, type TitleBarFieldId } from '../lib/settingsStore.svelte';
  import { tagStore, TAG_COLORS, type Tag } from '../lib/tagStore.svelte';

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

  let activePaneId = $state<PaneId | null>(null);
  let contextMenu = $state<{ x: number; y: number; paneId: string } | null>(null);
  let clipboardText = $state('');
  let renameModal = $state<{ sessionId: string; currentName: string } | null>(null);
  let renameValue = $state('');
  let renameInputEl: HTMLInputElement | undefined = $state(undefined);

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
    focus(paneId) { activePaneId = paneId; activePaneStore.id = paneId; },
    detach(paneId) { workspaceStore.closePane(paneId); },
    kill(paneId, sessionId) {
      if (effectiveManager) {
        effectiveManager.killSession(sessionId);
      }
      workspaceStore.closePane(paneId);
    },
    closePaneAction(paneId) { focusedPane.id = null; workspaceStore.closePane(paneId); },
    splitHorizontal(paneId) {
      focusedPane.id = null;
      const newPaneId = workspaceStore.splitPane(paneId, 'horizontal');
      if (newPaneId) {
        const tab = workspaceStore.get().tabs.find(t => t.id === workspaceStore.get().activeTabId);
        const sourcePane = tab ? findPane(tab.root, paneId) : null;
        const sourceCwd = sourcePane?.sessionId ? (sessionCwdStore.get(sourcePane.sessionId) ?? '') : '';
        actions.createNewTerminalWithCwd(newPaneId, sourceCwd);
      }
    },
    splitVertical(paneId) {
      focusedPane.id = null;
      const newPaneId = workspaceStore.splitPane(paneId, 'vertical');
      if (newPaneId) {
        const tab = workspaceStore.get().tabs.find(t => t.id === workspaceStore.get().activeTabId);
        const sourcePane = tab ? findPane(tab.root, paneId) : null;
        const sourceCwd = sourcePane?.sessionId ? (sessionCwdStore.get(sourcePane.sessionId) ?? '') : '';
        actions.createNewTerminalWithCwd(newPaneId, sourceCwd);
      }
    },
    commitResize(splitId, ratios) { workspaceStore.updateRatios(splitId, ratios); },
    toggleFocus(paneId) { focusedPane.id = focusedPane.id === paneId ? null : paneId; },
  });

  // Context menu actions
  function handleContextMenuClose() {
    contextMenu = null;
  }

  function getSourceCwdForPane(paneId: string): string {
    const ws = workspaceStore.get();
    const tab = ws.tabs.find(t => t.id === ws.activeTabId);
    const sourcePane = tab ? findPane(tab.root, paneId) : null;
    return sourcePane?.sessionId ? (sessionCwdStore.get(sourcePane.sessionId) ?? '') : '';
  }

  function handleSplitLeft() {
    if (contextMenu) {
      const cwd = getSourceCwdForPane(contextMenu.paneId);
      const newPaneId = workspaceStore.splitPaneBefore(contextMenu.paneId, 'horizontal');
      if (newPaneId) actions.createNewTerminalWithCwd(newPaneId, cwd);
      contextMenu = null;
    }
  }

  function handleSplitHorizontal() {
    if (contextMenu) {
      const cwd = getSourceCwdForPane(contextMenu.paneId);
      const newPaneId = workspaceStore.splitPane(contextMenu.paneId, 'horizontal');
      if (newPaneId) actions.createNewTerminalWithCwd(newPaneId, cwd);
      contextMenu = null;
    }
  }

  function handleSplitUp() {
    if (contextMenu) {
      const cwd = getSourceCwdForPane(contextMenu.paneId);
      const newPaneId = workspaceStore.splitPaneBefore(contextMenu.paneId, 'vertical');
      if (newPaneId) actions.createNewTerminalWithCwd(newPaneId, cwd);
      contextMenu = null;
    }
  }

  function handleSplitVertical() {
    if (contextMenu) {
      const cwd = getSourceCwdForPane(contextMenu.paneId);
      const newPaneId = workspaceStore.splitPane(contextMenu.paneId, 'vertical');
      if (newPaneId) actions.createNewTerminalWithCwd(newPaneId, cwd);
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
      renameModal = { sessionId: pane.sessionId, currentName };
      renameValue = currentName;
      contextMenu = null;
      setTimeout(() => renameInputEl?.select(), 0);
    }
  }

  function handleRenameSubmit() {
    if (renameModal && renameValue.trim() && renameValue.trim() !== renameModal.currentName) {
      actions.renameTerminal(renameModal.sessionId, renameValue.trim());
    }
    renameModal = null;
  }

  function handleRenameKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      handleRenameSubmit();
    } else if (event.key === 'Escape') {
      renameModal = null;
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

  function handleToggleTitleBarField(fieldId: TitleBarFieldId) {
    if (!contextMenu) return;
    const fields = getTitleBarFields(contextMenu.paneId);
    const field = fields.find(f => f.id === fieldId);
    if (field) setTitleBarFieldVisible(contextMenu.paneId, fieldId, !field.visible);
  }

  function handleResetTitleBar() {
    if (!contextMenu) return;
    clearTitleBarOverride(contextMenu.paneId);
    contextMenu = null;
  }

  // ── Tag management ──────────────────────────────────────────────────────────
  let tagModal = $state<{ sessionId: string } | null>(null);
  let tagName = $state('');
  let tagColor = $state(TAG_COLORS[0]);
  let tagInputEl: HTMLInputElement | undefined = $state(undefined);

  function handleOpenTagModal() {
    if (!contextMenu) return;
    const tab = $workspaceStore.tabs.find(t => t.id === $workspaceStore.activeTabId);
    if (!tab) { contextMenu = null; return; }
    const pane = findPane(tab.root, contextMenu.paneId);
    if (!pane?.sessionId) { contextMenu = null; return; }
    tagModal = { sessionId: pane.sessionId };
    tagName = '';
    tagColor = TAG_COLORS[0];
    contextMenu = null;
    setTimeout(() => tagInputEl?.focus(), 0);
  }

  function handleAddTag() {
    if (!tagModal || !tagName.trim()) return;
    tagStore.addTag(tagModal.sessionId, { name: tagName.trim(), color: tagColor });
    tagName = '';
    setTimeout(() => tagInputEl?.focus(), 0);
  }

  function handleTagKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') handleAddTag();
    else if (event.key === 'Escape') tagModal = null;
  }

  function handleRemoveTagFromMenu(sessionId: string, tagName: string) {
    tagStore.removeTag(sessionId, tagName);
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
        const cwd = getSourceCwdForPane(activePaneId);
        const newPaneId = workspaceStore.splitPane(activePaneId, 'horizontal');
        if (newPaneId) actions.createNewTerminalWithCwd(newPaneId, cwd);
      }
    }
    // Cmd/Ctrl + Shift + O = Split vertical
    else if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key === 'o') {
      event.preventDefault();
      if (activePaneId) {
        const cwd = getSourceCwdForPane(activePaneId);
        const newPaneId = workspaceStore.splitPane(activePaneId, 'vertical');
        if (newPaneId) actions.createNewTerminalWithCwd(newPaneId, cwd);
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
  let contextMenuItems = $derived(contextMenu ? (() => {
    void titleBarOverridesState.value;
    void settingsStore.value;
    void tagStore.tags;
    const fields = contextMenu ? getTitleBarFields(contextMenu.paneId) : [];
    const hasOverride = contextMenu ? hasTitleBarOverride(contextMenu.paneId) : false;
    const ctxTab = $workspaceStore.tabs.find(t => t.id === $workspaceStore.activeTabId);
    const ctxPane = ctxTab && contextMenu ? findPane(ctxTab.root, contextMenu.paneId) : null;
    const ctxSessionId = ctxPane?.sessionId ?? null;
    const ctxTags = ctxSessionId ? tagStore.getTags(ctxSessionId) : [];
    return [
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
    { label: 'Title Bar', action: () => {}, children: [
      ...(fields ?? []).map(f => ({
        label: `${f.visible ? '\u2713 ' : ''}${TITLE_BAR_FIELD_LABELS[f.id]}`,
        action: () => handleToggleTitleBarField(f.id),
      })),
      ...(hasOverride ? [
        { type: 'separator' as const },
        { label: 'Reset to Global', action: handleResetTitleBar },
      ] : []),
    ]},
    { label: 'Tags', action: () => {}, children: [
      { label: 'Add Tag...', action: handleOpenTagModal },
      ...(ctxTags.length > 0 ? [
        { type: 'separator' as const },
        ...ctxTags.map(t => ({
          label: `\u2715 ${t.name}`,
          action: () => ctxSessionId && handleRemoveTagFromMenu(ctxSessionId, t.name),
        })),
      ] : []),
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
  ];
  })() : []);
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="workspace-view">
  <div class="workspace-content">
    {#if $activeTab}
      <SplitContainer
        node={$activeTab.root}
        {activePaneId}
      />
    {:else}
      <div class="no-tab">
        <p>No tab selected</p>
        <button onclick={() => workspaceStore.createTab()}>Create Tab</button>
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

  {#if renameModal}
    <div class="rename-backdrop" onclick={() => renameModal = null} role="presentation">
      <div class="rename-modal" onclick={(e) => e.stopPropagation()}>
        <div class="rename-header">Rename Terminal</div>
        <input
          class="rename-input"
          type="text"
          bind:value={renameValue}
          bind:this={renameInputEl}
          onkeydown={handleRenameKeydown}
          placeholder="Session name"
        />
        <div class="rename-actions">
          <button class="rename-btn cancel" onclick={() => renameModal = null}>Cancel</button>
          <button class="rename-btn confirm" onclick={handleRenameSubmit}>Rename</button>
        </div>
      </div>
    </div>
  {/if}

  {#if tagModal}
    <div class="rename-backdrop" onclick={() => tagModal = null} role="presentation">
      <div class="rename-modal" onclick={(e) => e.stopPropagation()}>
        <div class="rename-header">Add Tag</div>
        {#if tagStore.getTags(tagModal.sessionId).length > 0}
          <div class="tag-list">
            {#each tagStore.getTags(tagModal.sessionId) as tag}
              <span class="tag-badge-modal" style="background: {tag.color}20; color: {tag.color}; border-color: {tag.color}40">
                {tag.name}
                <button class="tag-remove" onclick={() => tagModal && tagStore.removeTag(tagModal.sessionId, tag.name)}>&times;</button>
              </span>
            {/each}
          </div>
        {/if}
        <input
          class="rename-input"
          type="text"
          bind:value={tagName}
          bind:this={tagInputEl}
          onkeydown={handleTagKeydown}
          placeholder="Tag name"
        />
        <div class="tag-color-picker">
          {#each TAG_COLORS as color}
            <button
              class="tag-color-swatch"
              class:selected={tagColor === color}
              style="background: {color}"
              onclick={() => tagColor = color}
            ></button>
          {/each}
        </div>
        <div class="rename-actions">
          <button class="rename-btn cancel" onclick={() => tagModal = null}>Done</button>
          <button class="rename-btn confirm" onclick={handleAddTag} disabled={!tagName.trim()}>Add</button>
        </div>
      </div>
    </div>
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
    color: var(--ui-text-muted, #757578);
    gap: 16px;
  }

  .no-tab button {
    padding: 8px 16px;
    background: var(--ui-accent, #a0a7ff);
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
  }

  .no-tab button:hover {
    background: var(--ui-accent-hover, #8f97ff);
  }

  .rename-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    z-index: 1100;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .rename-modal {
    background: var(--ui-bg-secondary, #181a1c);
    border: 1px solid var(--ui-border, #454545);
    border-radius: 6px;
    padding: 16px;
    min-width: 300px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  }

  .rename-header {
    font-size: 14px;
    font-weight: 600;
    color: var(--ui-text-primary, #fdfbfe);
    margin-bottom: 12px;
  }

  .rename-input {
    width: 100%;
    padding: 6px 8px;
    background: var(--ui-bg-tertiary, #242629);
    border: 1px solid var(--ui-accent, #a0a7ff);
    border-radius: 4px;
    color: var(--ui-text-primary, white);
    font-size: 13px;
    outline: none;
    box-sizing: border-box;
  }

  .rename-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 12px;
  }

  .rename-btn {
    padding: 6px 14px;
    border: none;
    border-radius: 4px;
    font-size: 13px;
    cursor: pointer;
  }

  .rename-btn.cancel {
    background: var(--ui-bg-tertiary, #242629);
    color: var(--ui-text-primary, #fdfbfe);
  }

  .rename-btn.cancel:hover {
    background: var(--ui-bg-hover, #4a4a4a);
  }

  .rename-btn.confirm {
    background: var(--ui-accent, #a0a7ff);
    color: white;
  }

  .rename-btn.confirm:hover {
    background: var(--ui-accent-hover, #8f97ff);
  }

  .rename-btn.confirm:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .tag-list {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 8px;
  }

  .tag-badge-modal {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 3px;
    border: 1px solid;
  }

  .tag-remove {
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    font-size: 13px;
    line-height: 1;
    padding: 0;
    opacity: 0.6;
  }

  .tag-remove:hover {
    opacity: 1;
  }

  .tag-color-picker {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
    margin: 8px 0 4px;
  }

  .tag-color-swatch {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    padding: 0;
  }

  .tag-color-swatch.selected {
    border-color: white;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.3);
  }

  .tag-color-swatch:hover {
    transform: scale(1.15);
  }
</style>
