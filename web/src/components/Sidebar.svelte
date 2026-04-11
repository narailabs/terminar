<script lang="ts">
  import TerminalList from './TerminalList.svelte';
  import type { SessionInfo } from '../lib/workspaceTypes';
  import { sidebarGroupStore } from '../lib/sidebarGroupStore.svelte';
  import { broadcastEnabled } from '../lib/broadcastStore.svelte';
  import { sidebarPositionStore } from '../lib/sidebarPositionStore.svelte';

  const MIN_WIDTH = 150;
  const MAX_WIDTH = 500;
  const DEFAULT_WIDTH = 250;
  const COLLAPSE_THRESHOLD = 100;
  const DRAG_THRESHOLD = 20;

  let {
    sessions = [],
    activeSessionId = null,
    isOpen = true,
    broadcastMode = false,
    ontoggle,
    onclose,
    onrename,
    oncreate,
    ondockercreate,
    onsshcreate,
    onsettings,
    onpanedrop,
    onToggleBroadcast,
  }: {
    sessions?: SessionInfo[];
    activeSessionId?: string | null;
    isOpen?: boolean;
    broadcastMode?: boolean;
    ontoggle?: () => void;
    onclose?: (sessionId: string) => void;
    onrename?: (detail: { id: string; newName: string }) => void;
    oncreate?: () => void;
    ondockercreate?: () => void;
    onsshcreate?: () => void;
    onsettings?: () => void;
    onpanedrop?: (detail: { sourcePaneId: string }) => void;
    onToggleBroadcast?: () => void;
  } = $props();

  let position = $derived(sidebarPositionStore.value);
  let isLeft = $derived(position === 'left');

  // Chevron characters based on position and open state
  let chevronChar = $derived(
    isLeft
      ? (isOpen ? '‹' : '›')
      : (isOpen ? '›' : '‹')
  );

  // Shortcuts popup
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

  // --- Resize ---

  let sidebarWidth = $state(DEFAULT_WIDTH);
  let isResizing = $state(false);

  function startResize(e: MouseEvent) {
    if (!isOpen) return;
    e.preventDefault();
    isResizing = true;
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    function onMouseMove(e: MouseEvent) {
      const delta = isLeft
        ? (e.clientX - startX)
        : (startX - e.clientX);
      const newWidth = startWidth + delta;
      if (newWidth < COLLAPSE_THRESHOLD) {
        ontoggle?.();
        onMouseUp();
        return;
      }
      sidebarWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, newWidth));
    }

    function onMouseUp() {
      isResizing = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  function handleEdgeDblClick() {
    if (!isOpen) {
      ontoggle?.();
    } else {
      sidebarWidth = DEFAULT_WIDTH;
    }
  }

  function handleEdgeClick() {
    if (!isOpen) ontoggle?.();
  }

  // --- Sidebar drag (reposition left/right) ---

  let isDraggingSidebar = $state(false);
  let dragTarget = $state<'left' | 'right'>(position);

  function startSidebarDrag(e: MouseEvent) {
    isDraggingSidebar = true;
    dragTarget = position;
    const startX = e.clientX;
    document.body.style.cursor = 'grabbing';

    function onMouseMove(e: MouseEvent) {
      const midX = window.innerWidth / 2;
      dragTarget = e.clientX < midX ? 'left' : 'right';
    }

    function onMouseUp(e: MouseEvent) {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      isDraggingSidebar = false;

      const movedEnough = Math.abs(e.clientX - startX) > DRAG_THRESHOLD;
      if (movedEnough && dragTarget !== position) {
        sidebarPositionStore.set(dragTarget);
      }
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  // --- Sidebar header drag ---

  function handleHeaderMouseDown(e: MouseEvent) {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    startSidebarDrag(e);
  }

  // --- Toggle-btn dual behavior (click vs long-press drag) ---

  let toggleBtnTimer: ReturnType<typeof setTimeout> | null = null;
  let toggleBtnDragActivated = false;

  function handleToggleBtnDown(e: MouseEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    toggleBtnDragActivated = false;

    toggleBtnTimer = setTimeout(() => {
      toggleBtnDragActivated = true;
      startSidebarDrag(e);
    }, 1000);
  }

  function handleToggleBtnUp() {
    if (toggleBtnTimer) {
      clearTimeout(toggleBtnTimer);
      toggleBtnTimer = null;
    }
    if (!toggleBtnDragActivated) {
      ontoggle?.();
    }
  }

  function handleToggleBtnLeave() {
    if (toggleBtnTimer && !toggleBtnDragActivated) {
      clearTimeout(toggleBtnTimer);
      toggleBtnTimer = null;
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="sidebar"
  class:open={isOpen}
  class:resizing={isResizing}
  class:dragging-sidebar={isDraggingSidebar}
  class:position-left={isLeft}
  class:position-right={!isLeft}
  style:width={isOpen ? `${sidebarWidth}px` : ''}
>
  <div
    class="resize-handle"
    onmousedown={startResize}
    ondblclick={handleEdgeDblClick}
    role="separator"
    aria-orientation="vertical"
    title={isOpen ? 'Drag to resize' : ''}
  ></div>

  <button
    class="toggle-btn"
    onmousedown={handleToggleBtnDown}
    onmouseup={handleToggleBtnUp}
    onmouseleave={handleToggleBtnLeave}
    title={isOpen ? 'Hide sidebar' : 'Show sidebar'}
  >
    <span class="chevron">{chevronChar}</span>
  </button>

  {#if isOpen}
    <div class="sidebar-content">
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="sidebar-header" onmousedown={handleHeaderMouseDown}>
        <div class="header-icons">
          <div class="shortcuts-wrapper">
            <button
              class="header-icon-btn"
              onclick={toggleShortcuts}
              title="Keyboard Shortcuts"
              aria-label="Show keyboard shortcuts"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
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
            class="header-icon-btn"
            class:active={broadcastEnabled.value}
            onclick={() => onToggleBroadcast?.()}
            title="Broadcast Mode"
            aria-label="Toggle broadcast mode"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 1a.5.5 0 0 1 .5.5v1.527A6.5 6.5 0 0 1 14.5 9.5a.5.5 0 0 1-1 0 5.5 5.5 0 0 0-5-5.478V5.5a.5.5 0 0 1-1 0V4.022A5.5 5.5 0 0 0 2.5 9.5a.5.5 0 0 1-1 0A6.5 6.5 0 0 1 7.5 3.027V1.5A.5.5 0 0 1 8 1zM5.5 9.5a2.5 2.5 0 1 1 5 0 2.5 2.5 0 0 1-5 0zm1 0a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0zM4 9.5a4 4 0 0 1 4-4 .5.5 0 0 1 0 1 3 3 0 0 0-3 3 .5.5 0 0 1-1 0zm7 0a3 3 0 0 0-3-3 .5.5 0 0 1 0-1 4 4 0 0 1 4 4 .5.5 0 0 1-1 0z"/>
            </svg>
          </button>
          <button
            class="header-icon-btn"
            onclick={() => onsettings?.()}
            title="Terminal Settings"
            aria-label="Open terminal settings"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path fill-rule="evenodd" clip-rule="evenodd" d="M9.1 4.4L8.6 2H7.4L6.9 4.4L6.5 4.6L4.4 3.5L3.5 4.4L4.6 6.5L4.4 6.9L2 7.4V8.6L4.4 9.1L4.6 9.5L3.5 11.6L4.4 12.5L6.5 11.4L6.9 11.6L7.4 14H8.6L9.1 11.6L9.5 11.4L11.6 12.5L12.5 11.6L11.4 9.5L11.6 9.1L14 8.6V7.4L11.6 6.9L11.4 6.5L12.5 4.4L11.6 3.5L9.5 4.6L9.1 4.4ZM8 10C9.1046 10 10 9.1046 10 8C10 6.8954 9.1046 6 8 6C6.8954 6 6 6.8954 6 8C6 9.1046 6.8954 10 8 10Z"/>
            </svg>
          </button>
        </div>
        <div class="header-actions">
          <span class="count">{sessions.length}</span>
          <button
            class="header-icon-btn"
            title="New Group"
            onclick={() => {
              sidebarGroupStore.createGroup('New Group');
            }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M14 4H9.618l-1-2H2a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1z"/>
            </svg>
          </button>
          <button
            class="header-icon-btn"
            title="New Terminal"
            onclick={() => oncreate?.()}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 1.5a.5.5 0 0 1 .5.5v5.5H14a.5.5 0 0 1 0 1H8.5V14a.5.5 0 0 1-1 0V8.5H2a.5.5 0 0 1 0-1h5.5V2a.5.5 0 0 1 .5-.5z"/>
            </svg>
          </button>
          <button
            class="header-icon-btn"
            title="Docker Container"
            onclick={() => ondockercreate?.()}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M1.5 9.5h2v2h-2zm2.5 0h2v2h-2zm2.5 0h2v2h-2zm2.5 0h2v2h-2zm0-2.5h2v2h-2zm-2.5 0h2v2h-2zm-2.5 0h2v2h-2zm2.5-2.5h2v2h-2zm2.5 0h2v2h-2zM14.5 10.5c-.4 0-.7-.1-1-.2-.3.8-1.1 1.2-1.9 1.2H2.5c-1.1 0-2-.6-2-1.5 0-.4.2-.8.5-1.1-.2-.3-.3-.6-.3-1 0-.8.5-1.4 1.3-1.6 0-.1 0-.2 0-.3 0-.8.7-1.5 1.5-1.5.3 0 .5.1.7.2.4-.6 1-1 1.8-1 1 0 1.8.7 2 1.6.2-.1.4-.1.5-.1.8 0 1.4.5 1.6 1.2h.3c.8 0 1.4.4 1.7 1-.1 0-.1 0-.1 0 .8.3 1.5.9 1.5 1.6 0 .8-.7 1.5-1.5 1.5z"/>
            </svg>
          </button>
          <button
            class="header-icon-btn"
            title="SSH Connection"
            onclick={() => onsshcreate?.()}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M1 3h14v10H1V3zm1 1v8h12V4H2zm1 1h2v1H3V5zm0 2h2v1H3V7zm0 2h2v1H3V9zm3-4h6v1H6V5zm0 2h4v1H6V7zm0 2h5v1H6V9z"/>
            </svg>
          </button>
        </div>
      </div>
      <TerminalList
        {sessions}
        {activeSessionId}
        {broadcastMode}
        onclose={onclose}
        onrename={onrename}
        oncreate={oncreate}
        onsettings={onsettings}
        onpanedrop={onpanedrop}
      />
    </div>
  {/if}
</div>

{#if isDraggingSidebar}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="drag-overlay">
    <div class="drop-zone drop-left" class:active={dragTarget === 'left'} style:width="{sidebarWidth}px"></div>
    <div class="drop-spacer"></div>
    <div class="drop-zone drop-right" class:active={dragTarget === 'right'} style:width="{sidebarWidth}px"></div>
  </div>
{/if}

<style>
  .sidebar {
    zoom: var(--controls-zoom, 1);
    display: flex;
    position: relative;
    background: var(--ui-bg-secondary, #181a1c);
    height: 100%;
    transition: width 0.15s ease;
  }

  .sidebar.position-right {
    border-left: 1px solid var(--ui-border, #47484a);
  }

  .sidebar.position-left {
    border-right: 1px solid var(--ui-border, #47484a);
  }

  .sidebar.resizing {
    transition: none;
    user-select: none;
  }

  .sidebar.dragging-sidebar {
    opacity: 0.6;
    pointer-events: none;
  }

  .sidebar:not(.open) {
    width: 16px;
  }

  /* Resize handle — right side when left, left side when right */
  .resize-handle {
    position: absolute;
    top: 0;
    width: 6px;
    height: 100%;
    cursor: col-resize;
    z-index: 10;
  }

  .sidebar.position-right .resize-handle {
    left: -3px;
  }

  .sidebar.position-left .resize-handle {
    right: -3px;
    left: auto;
  }

  .sidebar:not(.open) .resize-handle {
    display: none;
  }

  .resize-handle:hover,
  .sidebar.resizing .resize-handle {
    background: var(--ui-accent, #4d9ef5);
    opacity: 0.5;
  }

  /* Toggle button — position flips based on side */
  .toggle-btn {
    width: 16px;
    height: 100%;
    background: none;
    border: none;
    color: var(--ui-text-muted, #808080);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: background 0.1s;
  }

  .sidebar.position-right .toggle-btn {
    border-right: 1px solid var(--ui-border, #47484a);
    order: 0;
  }

  .sidebar.position-left .toggle-btn {
    border-left: 1px solid var(--ui-border, #47484a);
    order: 2;
  }

  .toggle-btn:hover {
    background: var(--ui-bg-secondary, #2a2a2a);
    color: var(--ui-text-primary, #fdfbfe);
  }

  .chevron {
    font-size: 16px;
    font-weight: bold;
  }

  .sidebar-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 0;
  }

  .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px 8px 12px;
    border-bottom: 1px solid var(--ui-border, #47484a);
    cursor: grab;
  }

  .sidebar.dragging-sidebar .sidebar-header {
    cursor: grabbing;
  }

  .header-icons {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .shortcuts-wrapper {
    position: relative;
  }

  .header-icon-btn.active {
    color: var(--ui-accent, #a0a7ff);
    background: rgba(14, 99, 156, 0.15);
  }

  .shortcuts-popup {
    position: absolute;
    top: 100%;
    left: 0;
    margin-top: 6px;
    background: var(--ui-bg-secondary, #181a1c);
    border: 1px solid var(--ui-border, #47484a);
    border-radius: 6px;
    padding: 10px 14px;
    min-width: 240px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    z-index: 1000;
    animation: fadeIn 0.15s ease-out;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
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

  .count {
    background: var(--ui-bg-tertiary, #242629);
    color: var(--ui-text-primary, #fdfbfe);
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 10px;
    min-width: 18px;
    text-align: center;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-left: auto;
  }

  .header-icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    background: none;
    border: none;
    border-radius: 4px;
    color: var(--ui-text-muted, #808080);
    cursor: pointer;
    padding: 0;
    transition: background 0.1s, color 0.1s;
  }

  .header-icon-btn:hover {
    background: var(--ui-bg-tertiary, #363636);
    color: var(--ui-text-primary, #fdfbfe);
  }

  /* Drag overlay */
  .drag-overlay {
    position: fixed;
    top: 38px;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    z-index: 9999;
    pointer-events: none;
  }

  .drop-zone {
    flex-shrink: 0;
    border: 2px dashed transparent;
    transition: background 0.15s, border-color 0.15s;
  }

  .drop-spacer {
    flex: 1;
  }

  .drop-zone.active {
    background: color-mix(in srgb, var(--ui-accent, #a0a7ff) 20%, transparent);
    border-color: color-mix(in srgb, var(--ui-accent, #a0a7ff) 50%, transparent);
  }
</style>
