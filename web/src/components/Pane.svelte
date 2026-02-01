<script lang="ts">
  import { createEventDispatcher, onDestroy } from 'svelte';
  import Terminal from './Terminal.svelte';
  import type { SessionManager, SessionInfo } from '../lib/SessionManager';
  import type { SessionId, DropZone } from '../lib/workspaceTypes';
  import { settingsStore } from '../lib/settingsStore';
  import { registerPane, unregisterPane } from '../lib/paneRegistry';

  export let paneId: string;
  export let sessionId: SessionId | null;
  export let manager: SessionManager | null = null;
  export let isActive: boolean = false;

  let showTitleBar = true;
  let sessionName = '';

  const unsubSettings = settingsStore.subscribe((s) => {
    showTitleBar = s.showPaneTitleBars;
  });

  function updateSessionName() {
    if (sessionId && manager) {
      const session = manager.getLastSessionList().find((s: SessionInfo) => s.id === sessionId);
      sessionName = session?.name ?? '';
    } else {
      sessionName = '';
    }
  }

  function onSessionListUpdated() {
    updateSessionName();
  }

  let prevManager: SessionManager | null = null;

  // React to prop changes and manage listener lifecycle
  $: {
    if (prevManager && prevManager !== manager && typeof prevManager.removeListener === 'function') {
      prevManager.removeListener('sessionList', onSessionListUpdated);
    }
    if (manager && manager !== prevManager && typeof manager.on === 'function') {
      manager.on('sessionList', onSessionListUpdated);
    }
    prevManager = manager ?? null;
    // Also update name when sessionId or manager changes
    updateSessionName();
  }

  onDestroy(() => {
    unsubSettings();
    unregisterPane(paneId);
    if (prevManager && typeof prevManager.removeListener === 'function') {
      prevManager.removeListener('sessionList', onSessionListUpdated);
    }
  });

  const dispatch = createEventDispatcher<{
    drop: { paneId: string; sessionId: SessionId; dropZone: DropZone };
    contextmenu: { paneId: string; x: number; y: number };
    focus: { paneId: string };
    detach: { paneId: string };
    kill: { paneId: string; sessionId: SessionId };
  }>();

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
      <span class="pane-title-text">{sessionName}</span>
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
      <Terminal bind:this={terminalRef} {manager} activeSessionId={sessionId} {isActive} />
    {:else}
      <div class="empty-pane">
        <p>Drag a session here</p>
        <p class="hint">or right-click for options</p>
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

  .pane.active {
    border-color: var(--ui-accent, #0e639c);
  }

  .empty-pane {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--ui-text-muted, #666);
    user-select: none;
  }

  .empty-pane p {
    margin: 4px 0;
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
