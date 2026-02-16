<script lang="ts">
  import { createEventDispatcher, onDestroy, onMount } from 'svelte';
  import Terminal from './Terminal.svelte';
  import SearchBar from './SearchBar.svelte';

  import type { SessionId, DropZone } from '../lib/workspaceTypes';
  import { workspaceStore } from '../lib/workspaceStore';
  import { settingsStore } from '../lib/settingsStore';
  import { registerPane, unregisterPane } from '../lib/paneRegistry';
  import { searchStore } from '../lib/searchStore';
  import { broadcastTargets, broadcastEnabled } from '../lib/broadcastStore';
  import { exitedSessions } from '../lib/exitedSessionsStore';
  import { foregroundStore } from '../lib/foregroundStore';
  import { getKeyBindingRegistry } from '../lib/keybindings';
  import { createActionDispatcher } from '../lib/actionDispatcher';
  import { createKeyEventHandler } from '../lib/keyEventHandler';
  import { getManagerContext, getSessionsContext, getActionsContext } from '../lib/sessionContext';

  export let paneId: string;
  export let sessionId: SessionId | null;
  export let isActive: boolean = false;

  const managerStore = getManagerContext();
  const sessionsStore = getSessionsContext();
  const actions = getActionsContext();
  $: manager = $managerStore;

  let showTitleBar = true;

  // Live session info from sessions store (updated by CwdChanged events)
  $: currentSession = sessionId ? $sessionsStore.find(s => s.id === sessionId) : null;
  $: sessionName = currentSession?.name ?? '';
  $: sessionCwd = currentSession?.cwd ?? '';
  $: sessionShell = (() => {
    const sh = currentSession?.shell ?? '';
    return sh.split('/').pop() || sh;
  })();

  // Broadcast target indicator
  $: isBroadcastTarget = $broadcastEnabled && sessionId !== null && $broadcastTargets.has(sessionId);

  // Exited session state (subscribe to $exitedSessions for reactivity)
  $: sessionExited = sessionId ? $exitedSessions.has(sessionId) : false;
  $: exitInfo = sessionId && $exitedSessions.has(sessionId) ? $exitedSessions.get(sessionId) : undefined;
  $: exitBadgeText = exitInfo ? (exitInfo.exitCode !== null ? `[exited: ${exitInfo.exitCode}]` : '[exited]') : '';

  // Foreground process tracking (subscribe to $foregroundStore for reactivity)
  $: foregroundProcess = sessionId ? $foregroundStore.processes.get(sessionId) ?? null : null;
  const SHELL_NAMES = new Set(['sh', 'bash', 'zsh', 'fish', 'dash', 'ksh', 'csh', 'tcsh', 'ash', 'nu', 'pwsh', 'login']);
  $: processBadge = foregroundProcess && !SHELL_NAMES.has(foregroundProcess) ? foregroundProcess : null;
  // Compact cwd: show last directory component, or ~ for home
  $: displayCwd = (() => {
    if (!sessionCwd) return '';
    const home = '/Users/' + (sessionCwd.split('/')[2] || '');
    if (sessionCwd === home) return '~';
    if (sessionCwd.startsWith(home + '/')) return '~/' + sessionCwd.slice(home.length + 1);
    return sessionCwd;
  })();

  // Search state (subscribed from store)
  let searchIsOpen = false;
  let searchCurrentMatch = 0;
  let searchTotalMatches = 0;
  let searchCaseSensitive = false;
  let searchUseRegex = false;
  let searchQuery = '';

  const unsubSearch = searchStore.subscribe((s) => {
    const isTarget = s.paneId === paneId;
    searchIsOpen = s.isOpen && isTarget;
    searchCurrentMatch = isTarget ? s.currentMatch : 0;
    searchTotalMatches = isTarget ? s.totalMatches : 0;
    searchCaseSensitive = s.caseSensitive;
    searchUseRegex = s.useRegex;
    searchQuery = isTarget ? s.query : '';
  });

  const unsubSettings = settingsStore.subscribe((s) => {
    showTitleBar = s.showPaneTitleBars;
  });

  onDestroy(() => {
    unsubSettings();
    unsubSearch();
    unregisterPane(paneId);
  });

  const dispatch = createEventDispatcher<{
    drop: { paneId: string; sessionId: SessionId; dropZone: DropZone };
    contextmenu: { paneId: string; x: number; y: number };
    focus: { paneId: string };
    detach: { paneId: string };
    kill: { paneId: string; sessionId: SessionId };
    'action:pane.close': { paneId: string };
    'action:split.horizontal': { paneId: string };
    'action:split.vertical': { paneId: string };
  }>();

  // Callback from Terminal's SearchAddon onDidChangeResults
  function handleSearchResults(resultIndex: number, resultCount: number) {
    searchStore.setMatchInfo(resultIndex, resultCount);
  }

  // Search event handlers
  function handleSearch(event: CustomEvent<{ query: string; caseSensitive: boolean; useRegex: boolean }>) {
    const { query, caseSensitive, useRegex } = event.detail;
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
    onPaneClose: () => dispatch('action:pane.close', { paneId }),
    onSplitHorizontal: () => dispatch('action:split.horizontal', { paneId }),
    onSplitVertical: () => dispatch('action:split.vertical', { paneId }),
  });

  // Create key event handler using the keybinding registry
  const registry = getKeyBindingRegistry();
  const handleKeyEvent = createKeyEventHandler(registry, actionDispatch);

  // Register custom key event handler on terminal mount
  onMount(() => {
    queueMicrotask(() => {
      terminalRef?.registerCustomKeyEventHandler((event: KeyboardEvent) => {
        return handleKeyEvent(event);
      });
    });
  });

  let showClosePopup = false;
  let closeButtonRef: HTMLButtonElement;
  let popupRef: HTMLDivElement;

  function toggleClosePopup(event: MouseEvent) {
    event.stopPropagation();
    showClosePopup = !showClosePopup;
  }

  function handleDetach() {
    showClosePopup = false;
    dispatch('detach', { paneId });
  }

  function handleKill() {
    if (sessionId) {
      showClosePopup = false;
      dispatch('kill', { paneId, sessionId });
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

  let terminalRef: Terminal;

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

  // Register this pane so WorkspaceView can access its methods by paneId
  $: {
    registerPane(paneId, { getSelection, pasteText, selectAll, refreshTerminal });
  }

  let dropZone: DropZone | null = null;
  let isDragOver = false;

  function handleDragOver(event: DragEvent) {
    event.preventDefault();
    if (!event.dataTransfer) return;

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

    const dragSessionId = event.dataTransfer?.getData('text/plain');
    if (dragSessionId && dropZone) {
      dispatch('drop', { paneId, sessionId: dragSessionId, dropZone });
    }
    dropZone = null;
  }

  function handleContextMenu(event: MouseEvent) {
    event.preventDefault();
    dispatch('contextmenu', { paneId, x: event.clientX, y: event.clientY });
  }

  function handleClick() {
    dispatch('focus', { paneId });
  }
</script>

<svelte:window on:click={handleWindowClick} on:keydown={handlePopupKeydown} />

<div
  class="pane"
  class:active={isActive}
  class:exited={sessionExited}
  class:broadcast-target={isBroadcastTarget}
  class:drag-over={isDragOver}
  class:drop-left={dropZone === 'left'}
  class:drop-right={dropZone === 'right'}
  class:drop-top={dropZone === 'top'}
  class:drop-bottom={dropZone === 'bottom'}
  class:drop-center={dropZone === 'center'}
  on:dragover={handleDragOver}
  on:dragleave={handleDragLeave}
  on:drop={handleDrop}
  on:contextmenu={handleContextMenu}
  on:mousedown={handleClick}
  role="region"
  tabindex="-1"
>
  {#if showTitleBar && sessionName}
    <div class="pane-title-bar">
      <span class="pane-title-text">{sessionName}{#if sessionShell} · {sessionShell}{/if}{#if displayCwd} · {displayCwd}{/if}{#if processBadge} · <span class="process-badge">{processBadge}</span>{/if}</span>
      {#if sessionExited}<span class="exited-badge">{exitBadgeText}</span>{/if}
      <span class="title-bar-spacer"></span>
      <button
        class="title-bar-icon-btn"
        on:click={() => searchStore.open(paneId)}
        title="Search (Ctrl+F)"
        aria-label="Search terminal"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.5"/>
          <line x1="11" y1="11" x2="14" y2="14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>
      <button
        class="close-btn"
        bind:this={closeButtonRef}
        on:click={toggleClosePopup}
        title="Close"
        aria-label="Close pane options"
      >×</button>
      {#if showClosePopup}
        <div class="close-popup" bind:this={popupRef} on:keydown={handlePopupKeydown}>
          <button class="popup-item" on:click={handleDetach}>
            <span class="popup-label">Detach</span>
            <span class="popup-desc">Remove from pane</span>
          </button>
          <button class="popup-item destructive" on:click={handleKill}>
            <span class="popup-label">Terminate</span>
            <span class="popup-desc">End session</span>
          </button>
        </div>
      {/if}
    </div>
  {/if}

  <div class="pane-content">
    {#if sessionId && manager}
      <SearchBar
        isOpen={searchIsOpen}
        currentMatch={searchCurrentMatch}
        totalMatches={searchTotalMatches}
        caseSensitive={searchCaseSensitive}
        useRegex={searchUseRegex}
        on:search={handleSearch}
        on:next={handleSearchNext}
        on:previous={handleSearchPrevious}
        on:close={handleSearchClose}
        on:toggleCaseSensitive={handleToggleCaseSensitive}
        on:toggleRegex={handleToggleRegex}
      />
      <Terminal bind:this={terminalRef} activeSessionId={sessionId} {isActive} {paneId} onSearchResults={handleSearchResults} />
    {:else}
      <div class="empty-pane">
        <button class="empty-pane-btn" on:click={() => actions.createNewTerminal()}>New Terminal</button>
        {#if $sessionsStore.length > 0}
          <select
            class="empty-pane-select"
            on:change={(e) => {
              const val = e.currentTarget.value;
              if (val) {
                workspaceStore.assignSession(paneId, val);
                e.currentTarget.value = '';
              }
            }}
          >
            <option value="">Attach existing session...</option>
            {#each $sessionsStore as session}
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
    background: var(--ui-bg-primary, #1e1e1e);
    border: 1px solid transparent;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .pane-title-bar {
    position: relative;
    height: 22px;
    min-height: 22px;
    background: var(--ui-bg-secondary, #2d2d2d);
    color: var(--ui-text-secondary, #999);
    font-size: 11px;
    line-height: 22px;
    padding: 0 8px;
    white-space: nowrap;
    overflow: visible;
    user-select: none;
    border-bottom: 1px solid var(--ui-border, #3c3c3c);
    display: flex;
    align-items: center;
  }

  .pane-title-text {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .close-btn {
    flex-shrink: 0;
    width: 18px;
    height: 18px;
    border: none;
    background: transparent;
    color: var(--ui-text-secondary, #999);
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
    background: var(--ui-bg-tertiary, #3c3c3c);
    color: var(--ui-text-primary, #ccc);
  }

  .title-bar-spacer {
    flex: 1;
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
    color: var(--ui-text-muted, #888);
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }

  .title-bar-icon-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: var(--ui-text-primary, #fff);
  }

  .close-popup {
    position: absolute;
    top: 22px;
    right: 4px;
    z-index: 200;
    background: var(--ui-bg-secondary, #252526);
    border: 1px solid var(--ui-border, #3c3c3c);
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
    color: var(--ui-text-primary, #ccc);
    cursor: pointer;
    text-align: left;
    font-size: 12px;
  }

  .popup-item:hover {
    background: var(--ui-bg-hover, #094771);
  }

  .popup-item.destructive:hover {
    background: var(--ui-destructive-hover, #5a1d1d);
  }

  .popup-label {
    font-weight: 500;
  }

  .popup-desc {
    font-size: 10px;
    color: var(--ui-text-muted, #888);
    margin-top: 1px;
  }

  .popup-item.destructive .popup-label {
    color: var(--ui-destructive, #f48771);
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

  .process-badge {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.08);
    color: #9a9a9a;
  }

  .pane.active {
    border-color: var(--ui-accent, #0e639c);
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
    background: var(--ui-accent, #0e639c);
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
  }

  .empty-pane-btn:hover {
    background: var(--ui-accent-hover, #1177bb);
  }

  .empty-pane-select {
    padding: 4px 8px;
    background: var(--ui-bg-secondary, #2d2d2d);
    color: var(--ui-text-primary, #ccc);
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
    border: 2px dashed var(--ui-accent, #0e639c);
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
</style>
