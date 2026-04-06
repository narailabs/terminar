<script lang="ts">
  import TerminalList from './TerminalList.svelte';
  import type { SessionInfo } from '../lib/workspaceTypes';
  import { sidebarGroupStore } from '../lib/sidebarGroupStore.svelte';

  const MIN_WIDTH = 150;
  const MAX_WIDTH = 500;
  const DEFAULT_WIDTH = 250;
  const COLLAPSE_THRESHOLD = 100;

  let {
    sessions = [],
    activeSessionId = null,
    isOpen = true,
    broadcastMode = false,
    ontoggle,
    onclose,
    onrename,
    oncreate,
    onsettings,
    onpanedrop,
  }: {
    sessions?: SessionInfo[];
    activeSessionId?: string | null;
    isOpen?: boolean;
    broadcastMode?: boolean;
    ontoggle?: () => void;
    onclose?: (sessionId: string) => void;
    onrename?: (detail: { id: string; newName: string }) => void;
    oncreate?: () => void;
    onsettings?: () => void;
    onpanedrop?: (detail: { sourcePaneId: string }) => void;
  } = $props();

  let sidebarWidth = $state(DEFAULT_WIDTH);
  let isResizing = $state(false);

  function startResize(e: MouseEvent) {
    if (!isOpen) return;
    e.preventDefault();
    isResizing = true;
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    function onMouseMove(e: MouseEvent) {
      const delta = startX - e.clientX;
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
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="sidebar"
  class:open={isOpen}
  class:resizing={isResizing}
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

  <button class="toggle-btn" onclick={() => ontoggle?.()} title={isOpen ? 'Hide sidebar' : 'Show sidebar'}>
    <span class="chevron">{isOpen ? '›' : '‹'}</span>
  </button>

  {#if isOpen}
    <div class="sidebar-content">
      <div class="sidebar-header">
        <h3>terminar</h3>
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

<style>
  .sidebar {
    zoom: var(--controls-zoom, 1);
    display: flex;
    position: relative;
    background: var(--ui-bg-secondary, #181a1c);
    border-left: 1px solid var(--ui-border, #47484a);
    height: 100%;
    transition: width 0.15s ease;
  }

  .sidebar.resizing {
    transition: none;
    user-select: none;
  }

  .sidebar:not(.open) {
    width: 16px;
  }

  .resize-handle {
    position: absolute;
    left: -3px;
    top: 0;
    width: 6px;
    height: 100%;
    cursor: col-resize;
    z-index: 10;
  }

  .sidebar:not(.open) .resize-handle {
    display: none;
  }

  .resize-handle:hover,
  .sidebar.resizing .resize-handle {
    background: var(--ui-accent, #4d9ef5);
    opacity: 0.5;
  }

  .toggle-btn {
    width: 16px;
    height: 100%;
    background: none;
    border: none;
    border-right: 1px solid var(--ui-border, #47484a);
    color: var(--ui-text-muted, #808080);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: background 0.1s;
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
  }

  .sidebar-header h3 {
    margin: 0;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.5px;
    color: var(--ui-text-primary, #fdfbfe);
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
</style>
