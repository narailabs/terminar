<script lang="ts">
  import { onDestroy } from 'svelte';
  import Terminal from './Terminal.svelte';
  import SearchBar from './SearchBar.svelte';

  import type { SessionId, DropZone } from '../lib/workspaceTypes';
  import { workspaceStore } from '../lib/workspaceStore';
  import { settingsStore, getTitleBarFields, titleBarOverridesState, type TitleBarFieldEntry } from '../lib/settingsStore.svelte';
  import { registerPane, unregisterPane } from '../lib/paneRegistry';
  import { searchStore } from '../lib/searchStore.svelte';
  import { broadcastTargets, broadcastEnabled } from '../lib/broadcastStore.svelte';
  import { exitedSessions } from '../lib/exitedSessionsStore.svelte';
  import { focusedPane } from '../lib/focusStore.svelte';
  import { foregroundStore } from '../lib/foregroundStore.svelte';
  import { titleStore } from '../lib/titleStore.svelte';
  import { tagStore } from '../lib/tagStore.svelte';
  import { sidebarGroupStore } from '../lib/sidebarGroupStore.svelte';
  import { getKeyBindingRegistry } from '../lib/keybindings';
  import { createActionDispatcher } from '../lib/actionDispatcher';
  import { createKeyEventHandler } from '../lib/keyEventHandler';
  import { getManagerContext, getSessionsContext, getActionsContext, getPaneActionsContext } from '../lib/sessionContext.svelte';

  let {
    paneId,
    sessionId,
    isActive = false,
  }: {
    paneId: string;
    sessionId: SessionId | null;
    isActive?: boolean;
  } = $props();

  const managerBox = getManagerContext();
  const sessionsBox = getSessionsContext();
  const actions = getActionsContext();
  const paneActions = getPaneActionsContext();
  let manager = $derived(managerBox.value);

  let showTitleBar = $state(true);

  // Live session info from sessions store (updated by CwdChanged events)
  let currentSession = $derived(sessionId ? sessionsBox.value.find(s => s.id === sessionId) : null);
  let sessionName = $derived(currentSession?.name ?? '');
  let sessionCwd = $derived(currentSession?.cwd ?? '');
  let sessionShell = $derived((() => {
    const sh = currentSession?.shell ?? '';
    return sh.split('/').pop() || sh;
  })());

  // Focus (zoom) state
  let isFocused = $derived(focusedPane.id === paneId);

  // Broadcast target indicator
  let isBroadcastTarget = $derived(broadcastEnabled.value && sessionId !== null && broadcastTargets.value.has(sessionId));

  // Exited session state
  let sessionExited = $derived(sessionId ? exitedSessions.has(sessionId) : false);
  let exitInfo = $derived(sessionId && exitedSessions.has(sessionId) ? exitedSessions.get(sessionId) : undefined);
  let exitBadgeText = $derived(exitInfo ? (exitInfo.exitCode !== null ? `[exited: ${exitInfo.exitCode}]` : '[exited]') : '');

  // Terminal title set by apps via OSC 2 escape sequences (e.g. Claude, Gemini)
  let terminalTitle = $state('');

  function handleTitleChange(title: string) {
    terminalTitle = title;
    if (sessionId) {
      titleStore.setTitle(sessionId, title);
    }
  }

  // Reset terminal title when session changes
  $effect(() => {
    if (sessionId) {
      terminalTitle = '';
    }
  });

  // Foreground process tracking
  let foregroundProcess = $derived(sessionId ? foregroundStore.processes.get(sessionId) ?? null : null);
  const SHELL_NAMES = new Set(['sh', 'bash', 'zsh', 'fish', 'dash', 'ksh', 'csh', 'tcsh', 'ash', 'nu', 'pwsh', 'login']);
  let processBadge = $derived(foregroundProcess && !SHELL_NAMES.has(foregroundProcess) ? foregroundProcess : null);
  // Compact cwd: show last directory component, or ~ for home
  let displayCwd = $derived((() => {
    if (!sessionCwd) return '';
    const home = '/Users/' + (sessionCwd.split('/')[2] || '');
    if (sessionCwd === home) return '~';
    if (sessionCwd.startsWith(home + '/')) return '~/' + sessionCwd.slice(home.length + 1);
    return sessionCwd;
  })());

  // Search state (derived from store)
  let isSearchTarget = $derived(searchStore.state.paneId === paneId);
  let searchIsOpen = $derived(searchStore.state.isOpen && isSearchTarget);
  let searchCurrentMatch = $derived(isSearchTarget ? searchStore.state.currentMatch : 0);
  let searchTotalMatches = $derived(isSearchTarget ? searchStore.state.totalMatches : 0);
  let searchCaseSensitive = $derived(searchStore.state.caseSensitive);
  let searchUseRegex = $derived(searchStore.state.useRegex);
  let searchQuery = $derived(isSearchTarget ? searchStore.state.query : '');

  let dimInactivePanes = $state(0.4);

  const unsubSettings = settingsStore.subscribe((s) => {
    showTitleBar = s.showPaneTitleBars;
    dimInactivePanes = s.dimInactivePanes;
  });

  // Resolve which title bar fields to show, in order (global + per-pane overrides)
  let titleFields = $derived((() => {
    void titleBarOverridesState.value;
    void settingsStore.value;
    return getTitleBarFields(paneId);
  })());

  // Tags for current session
  let sessionTags = $derived(sessionId ? tagStore.getTags(sessionId) : []);
  let sessionGroup = $derived(sessionId ? sidebarGroupStore.getGroupForSession(sessionId) : null);

  // Map field IDs to their rendered values (tags returns placeholder — rendered specially)
  function getFieldValue(field: TitleBarFieldEntry): string {
    switch (field.id) {
      case 'sessionName': return sessionName;
      case 'terminalTitle': return terminalTitle;
      case 'shell': return sessionShell;
      case 'cwd': return displayCwd;
      case 'process': return processBadge ?? '';
      case 'tags': return sessionTags.length > 0 ? '\x00' : ''; // placeholder — rendered as badges
      case 'group': return sessionGroup?.name ?? '';
      default: return '';
    }
  }

  onDestroy(() => {
    unsubSettings();
    unregisterPane(paneId);
  });

  // Callback from Terminal's SearchAddon onDidChangeResults
  function handleSearchResults(resultIndex: number, resultCount: number) {
    searchStore.setMatchInfo(resultIndex, resultCount);
  }

  // Search event handlers
  function handleSearch(detail: { query: string; caseSensitive: boolean; useRegex: boolean }) {
    const { query, caseSensitive, useRegex } = detail;
    searchStore.setQuery(query);
    if (query) {
      terminalRef?.searchFindNext(query, { caseSensitive, regex: useRegex });
      // Match info is updated via onSearchResults callback from the SearchAddon
    } else {
      terminalRef?.searchClearDecorations();
      searchStore.setMatchInfo(0, 0);
    }
  }

  function handleSearchNext() {
    if (searchQuery) {
      terminalRef?.searchFindNext(searchQuery, {
        caseSensitive: searchCaseSensitive,
        regex: searchUseRegex,
      });
    }
  }

  function handleSearchPrevious() {
    if (searchQuery) {
      terminalRef?.searchFindPrevious(searchQuery, {
        caseSensitive: searchCaseSensitive,
        regex: searchUseRegex,
      });
    }
  }

  function handleSearchClose() {
    searchStore.close();
    terminalRef?.searchClearDecorations();
  }

  function handleToggleCaseSensitive() {
    searchStore.toggleCaseSensitive();
  }

  function handleToggleRegex() {
    searchStore.toggleRegex();
  }

  // Create action dispatcher for keybinding actions
  const actionDispatch = createActionDispatcher({
    onSearchOpen: () => searchStore.open(paneId),
    onSearchClose: () => {
      if (searchIsOpen) {
        searchStore.close();
        terminalRef?.searchClearDecorations();
      }
    },
    onSessionNew: () => actions.createNewTerminal(),
    onSidebarToggle: () => actions.toggleSidebar(),
    onPaneClose: () => paneActions.closePaneAction(paneId),
    onSplitHorizontal: () => paneActions.splitHorizontal(paneId),
    onSplitVertical: () => paneActions.splitVertical(paneId),
    onPaneFocus: () => paneActions.toggleFocus(paneId),
  });

  // Create key event handler using the keybinding registry
  const registry = getKeyBindingRegistry();
  const handleKeyEvent = createKeyEventHandler(registry, actionDispatch);

  // Register custom key event handler reactively when Terminal renders.
  // Terminal may mount after Pane's onMount (when currentSession arrives
  // asynchronously from the server), so we can't use onMount here.
  $effect(() => {
    if (terminalRef) {
      terminalRef.registerCustomKeyEventHandler((event: KeyboardEvent) => {
        return handleKeyEvent(event);
      });
    }
  });

  let showClosePopup = $state(false);
  let closeButtonRef = $state<HTMLButtonElement>();
  let popupRef = $state<HTMLDivElement>();

  function toggleClosePopup(event: MouseEvent) {
    event.stopPropagation();
    if (isFocused) {
      focusedPane.id = null;
      return;
    }
    showClosePopup = !showClosePopup;
  }

  function handleDetach() {
    showClosePopup = false;
    paneActions.detach(paneId);
  }

  function handleKill() {
    if (sessionId) {
      showClosePopup = false;
      paneActions.kill(paneId, sessionId);
    }
  }

  function handlePopupKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      if (searchIsOpen) {
        event.preventDefault();
        event.stopPropagation();
        handleSearchClose();
        return;
      }
      showClosePopup = false;
    }
  }

  function handleWindowClick(event: MouseEvent) {
    if (!showClosePopup) return;
    const target = event.target as Node;
    if (
      popupRef && !popupRef.contains(target) &&
      closeButtonRef && !closeButtonRef.contains(target)
    ) {
      showClosePopup = false;
    }
  }

  let terminalRef = $state<Terminal>();

  function getSelection(): string {
    return terminalRef?.getSelection() ?? '';
  }

  function pasteText(text: string) {
    terminalRef?.pasteText(text);
  }

  function selectAll() {
    terminalRef?.selectAll();
  }

  function refreshTerminal() {
    terminalRef?.refreshTerminal();
  }

  function refit() {
    terminalRef?.refit();
  }

  // Register this pane so WorkspaceView can access its methods by paneId
  $effect(() => {
    registerPane(paneId, { getSelection, pasteText, selectAll, refreshTerminal, refit });
  });

  // Refit terminal when focus mode toggles. The CSS position: fixed → static
  // transition causes a layout change that races with xterm's rendering.
  // refit() uses double-rAF + suppressResize to measure after layout settles.
  let prevFocused = false;
  $effect(() => {
    if (isFocused !== prevFocused) {
      prevFocused = isFocused;
      terminalRef?.refit();
    }
  });

  let dropZone = $state<DropZone | null>(null);
  let isDragOver = $state(false);
  let isPaneDragging = $state(false);

  // Pane title bar drag handlers
  function handleTitleDragStart(event: DragEvent) {
    if (!event.dataTransfer) return;
    event.dataTransfer.setData('application/x-terminar-pane', paneId);
    event.dataTransfer.effectAllowed = 'move';
    isPaneDragging = true;
  }

  function handleTitleDragEnd() {
    isPaneDragging = false;
  }

  function handleDragOver(event: DragEvent) {
    event.preventDefault();
    if (!event.dataTransfer) return;

    // Skip drop zone indicators when dragging over self
    if (isPaneDragging) return;

    isDragOver = true;

    // Calculate drop zone based on mouse position
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const width = rect.width;
    const height = rect.height;

    // Edge threshold (20% from edges)
    const edgeThreshold = 0.2;

    if (x < width * edgeThreshold) {
      dropZone = 'left';
    } else if (x > width * (1 - edgeThreshold)) {
      dropZone = 'right';
    } else if (y < height * edgeThreshold) {
      dropZone = 'top';
    } else if (y > height * (1 - edgeThreshold)) {
      dropZone = 'bottom';
    } else {
      dropZone = 'center';
    }
  }

  function handleDragLeave() {
    isDragOver = false;
    dropZone = null;
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    isDragOver = false;

    if (!dropZone) {
      dropZone = null;
      return;
    }

    // Check for pane drag first
    const sourcePaneId = event.dataTransfer?.getData('application/x-terminar-pane');
    if (sourcePaneId) {
      paneActions.paneDrop(sourcePaneId, paneId, dropZone);
      dropZone = null;
      return;
    }

    // Existing session drag behavior
    const dragSessionId = event.dataTransfer?.getData('text/plain');
    if (dragSessionId) {
      paneActions.drop(paneId, dragSessionId, dropZone);
    }
    dropZone = null;
  }

  function handleContextMenu(event: MouseEvent) {
    event.preventDefault();
    paneActions.contextMenu(paneId, event.clientX, event.clientY);
  }

  function handleClick() {
    paneActions.focus(paneId);
  }
</script>

<svelte:window onclick={handleWindowClick} onkeydown={handlePopupKeydown} />

<div
  class="pane"
  class:active={isActive}
  class:focused={isFocused}
  class:exited={sessionExited}
  class:broadcast-target={isBroadcastTarget}
  class:drag-over={isDragOver}
  class:drop-left={dropZone === 'left'}
  class:drop-right={dropZone === 'right'}
  class:drop-top={dropZone === 'top'}
  class:drop-bottom={dropZone === 'bottom'}
  class:drop-center={dropZone === 'center'}
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
  ondrop={handleDrop}
  oncontextmenu={handleContextMenu}
  onmousedown={handleClick}
  role="region"
  tabindex="-1"
>
  {#if showTitleBar && sessionName}
    <div
      class="pane-title-bar"
      draggable="true"
      ondragstart={handleTitleDragStart}
      ondragend={handleTitleDragEnd}
    >
      <span class="pane-title-text">{#each titleFields as field, i}{#if field.visible && getFieldValue(field)}{@const val = getFieldValue(field)}{#if i > 0 && titleFields.slice(0, i).some(f => f.visible && getFieldValue(f))}<span class="field-sep">·</span>{/if}{#if field.id === 'terminalTitle'}<span class="terminal-title">{val}</span>{:else if field.id === 'process'}<span class="process-badge">{val}</span>{:else if field.id === 'group'}<span class="title-group">{val}</span>{:else if field.id === 'tags'}{#each sessionTags as tag}<span class="title-tag" style="background: {tag.color}25; color: {tag.color}">{tag.name}</span>{/each}{:else}{val}{/if}{/if}{/each}</span>
      {#if sessionExited}<span class="exited-badge">{exitBadgeText}</span>{/if}
      <span class="title-bar-spacer"></span>
      <button
        class="title-bar-icon-btn"
        onclick={() => searchStore.open(paneId)}
        title="Search (Ctrl+F)"
        aria-label="Search terminal"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.5"/>
          <line x1="11" y1="11" x2="14" y2="14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>
      {#if !isFocused}
        <button
          class="title-bar-icon-btn"
          onclick={() => paneActions.toggleFocus(paneId)}
          title="Focus Pane (Cmd+Shift+F)"
          aria-label="Focus pane"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <polyline points="10,2 14,2 14,6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <polyline points="6,14 2,14 2,10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <polyline points="2,6 2,2 6,2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <polyline points="14,10 14,14 10,14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      {/if}
      <button
        class="close-btn"
        bind:this={closeButtonRef}
        onclick={toggleClosePopup}
        title="Close"
        aria-label="Close pane options"
      >×</button>
      {#if showClosePopup}
        <div class="close-popup" bind:this={popupRef} onkeydown={handlePopupKeydown}>
          <button class="popup-item" onclick={handleDetach}>
            <span class="popup-label">Detach</span>
            <span class="popup-desc">Remove from pane</span>
          </button>
          <button class="popup-item destructive" onclick={handleKill}>
            <span class="popup-label">Terminate</span>
            <span class="popup-desc">End session</span>
          </button>
        </div>
      {/if}
    </div>
  {/if}

  <div
    class="pane-content"
    style:opacity={!isActive && dimInactivePanes < 1 ? dimInactivePanes : undefined}
    style:transition={dimInactivePanes < 1 ? 'opacity 0.15s' : undefined}
  >
    {#if sessionId && managerBox.value && currentSession}
      <SearchBar
        isOpen={searchIsOpen}
        currentMatch={searchCurrentMatch}
        totalMatches={searchTotalMatches}
        caseSensitive={searchCaseSensitive}
        useRegex={searchUseRegex}
        onsearch={(detail) => handleSearch(detail)}
        onnext={() => handleSearchNext()}
        onprevious={() => handleSearchPrevious()}
        onclose={() => handleSearchClose()}
        ontogglecasesensitive={() => handleToggleCaseSensitive()}
        ontoggleregex={() => handleToggleRegex()}
      />
      <Terminal bind:this={terminalRef} activeSessionId={sessionId} {isActive} {paneId} onSearchResults={handleSearchResults} onTitleChange={handleTitleChange} />
    {:else}
      <div class="empty-pane">
        <button class="empty-pane-btn" onclick={() => actions.createNewTerminal()}>New Terminal</button>
        {#if sessionsBox.value.length > 0}
          <select
            class="empty-pane-select"
            onchange={(e) => {
              const val = e.currentTarget.value;
              if (val) {
                workspaceStore.assignSession(paneId, val);
                e.currentTarget.value = '';
              }
            }}
          >
            <option value="">Attach existing session...</option>
            {#each sessionsBox.value as session}
              <option value={session.id}>{session.name || session.id.slice(0, 8)}</option>
            {/each}
          </select>
        {/if}
        <p class="hint">or drag a session here</p>
      </div>
    {/if}
  </div>

  <!-- Drop zone indicator -->
  {#if isDragOver && dropZone}
    <div class="drop-indicator {dropZone}"></div>
  {/if}
</div>

<style>
  .pane {
    position: relative;
    width: 100%;
    height: 100%;
    min-width: 100px;
    min-height: 50px;
    background: var(--ui-bg-secondary, #181a1c);
    box-sizing: border-box;
    border: 1px solid var(--ui-border, #47484a);
    border-radius: 8px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .pane-title-bar {
    position: relative;
    height: 28px;
    min-height: 28px;
    background: var(--ui-bg-tertiary, #242629);
    color: var(--ui-text-secondary, #ababad);
    font-size: 12px;
    font-weight: 500;
    line-height: 28px;
    padding: 0 10px;
    white-space: nowrap;
    overflow: visible;
    user-select: none;
    border-bottom: 1px solid var(--ui-border, #47484a);
    display: flex;
    align-items: center;
    cursor: grab;
  }

  .pane-title-bar:active {
    cursor: grabbing;
  }

  .pane-title-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    direction: rtl;
    text-align: left;
  }

  .close-btn {
    flex-shrink: 0;
    width: 18px;
    height: 18px;
    border: none;
    background: transparent;
    color: var(--ui-text-secondary, #ababad);
    font-size: 14px;
    line-height: 18px;
    padding: 0;
    cursor: pointer;
    border-radius: 3px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .close-btn:hover {
    background: var(--ui-bg-tertiary, #242629);
    color: var(--ui-text-primary, #fdfbfe);
  }

  .title-bar-spacer {
    flex-shrink: 1000;
  }

  .title-bar-icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: 3px;
    color: var(--ui-text-muted, #757578);
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }

  .title-bar-icon-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: var(--ui-text-primary, #fdfbfe);
  }

  .close-popup {
    position: absolute;
    top: 22px;
    right: 4px;
    z-index: 200;
    background: var(--ui-bg-secondary, #181a1c);
    border: 1px solid var(--ui-border, #47484a);
    border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
    min-width: 160px;
    padding: 4px 0;
  }

  .popup-item {
    display: flex;
    flex-direction: column;
    width: 100%;
    padding: 6px 12px;
    border: none;
    background: transparent;
    color: var(--ui-text-primary, #fdfbfe);
    cursor: pointer;
    text-align: left;
    font-size: 12px;
  }

  .popup-item:hover {
    background: var(--ui-bg-hover, #1e2022);
  }

  .popup-item.destructive:hover {
    background: var(--ui-destructive-hover, #a70138);
  }

  .popup-label {
    font-weight: 500;
  }

  .popup-desc {
    font-size: 10px;
    color: var(--ui-text-muted, #757578);
    margin-top: 1px;
  }

  .popup-item.destructive .popup-label {
    color: var(--ui-destructive, #ff6e84);
  }

  .pane-content {
    flex: 1;
    min-height: 0;
    position: relative;
  }

  .pane.exited {
    opacity: 0.6;
  }

  .exited-badge {
    font-size: 11px;
    color: #e5c07b;
    margin-left: 8px;
  }

  .field-sep {
    margin: 0 6px;
    color: var(--ui-text-muted, #757578);
  }

  .terminal-title {
    color: var(--ui-text-primary, #fdfbfe);
  }

  .process-badge {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.08);
    color: #9a9a9a;
  }

  .title-tag {
    font-size: 9px;
    padding: 0 4px;
    border-radius: 3px;
    margin-left: 2px;
  }

  .title-group {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 3px;
    background: rgba(160, 167, 255, 0.12);
    color: var(--ui-accent, #a0a7ff);
    font-weight: 500;
  }

  .pane.active {
    border-color: var(--ui-accent, #a0a7ff);
  }

  .pane.broadcast-target {
    border-color: #e5c07b;
    border-width: 2px;
  }

  .pane.broadcast-target.active {
    border-color: #e5c07b;
  }

  .empty-pane {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    height: 100%;
    color: var(--ui-text-muted, #666);
    user-select: none;
  }

  .empty-pane-btn {
    padding: 6px 16px;
    background: var(--ui-accent, #a0a7ff);
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
  }

  .empty-pane-btn:hover {
    background: var(--ui-accent-hover, #8f97ff);
  }

  .empty-pane-select {
    padding: 4px 8px;
    background: var(--ui-bg-secondary, #181a1c);
    color: var(--ui-text-primary, #fdfbfe);
    border: 1px solid var(--ui-border, #454545);
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
    min-width: 180px;
  }

  .empty-pane .hint {
    font-size: 12px;
    color: var(--ui-text-muted, #555);
  }

  /* Drop zone indicators */
  .drop-indicator {
    position: absolute;
    background: rgba(14, 99, 156, 0.3);
    border: 2px dashed var(--ui-accent, #a0a7ff);
    pointer-events: none;
    z-index: 100;
  }

  .drop-indicator.center {
    inset: 4px;
  }

  .drop-indicator.left {
    top: 4px;
    left: 4px;
    bottom: 4px;
    width: calc(50% - 8px);
  }

  .drop-indicator.right {
    top: 4px;
    right: 4px;
    bottom: 4px;
    width: calc(50% - 8px);
  }

  .drop-indicator.top {
    top: 4px;
    left: 4px;
    right: 4px;
    height: calc(50% - 8px);
  }

  .drop-indicator.bottom {
    bottom: 4px;
    left: 4px;
    right: 4px;
    height: calc(50% - 8px);
  }

  .pane.focused {
    position: fixed;
    top: 10%;
    left: 10%;
    width: 80%;
    height: 80%;
    z-index: 50;
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
    opacity: 1 !important;
    animation: focus-open 0.2s ease-out both;
  }

  @keyframes focus-open {
    from {
      opacity: 0;
      transform: scale(0.92);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }
</style>
