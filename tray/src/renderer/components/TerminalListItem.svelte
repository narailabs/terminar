<script lang="ts">
  import type { Tag } from '../lib/tagStore.svelte';

  let {
    id,
    name,
    shell,
    cwd,
    foregroundProcess = null,
    terminalTitle = '',
    paneCount = 0,
    tags = [],
    isActive = false,
    startEditing = false,
    onselect,
    onclose,
    onrename,
    oneditend,
    oncontextmenu: oncontextmenuprop,
  }: {
    id: string;
    name: string;
    shell: string;
    cwd: string;
    foregroundProcess?: string | null;
    terminalTitle?: string;
    paneCount?: number;
    tags?: Tag[];
    isActive?: boolean;
    startEditing?: boolean;
    onselect?: (id: string) => void;
    onclose?: (id: string) => void;
    onrename?: (detail: { id: string; newName: string }) => void;
    oneditend?: (id: string) => void;
    oncontextmenu?: (detail: { id: string; x: number; y: number }) => void;
  } = $props();

  let isEditing = $state(false);
  let editValue = $state(name);

  // React to external edit trigger
  $effect(() => {
    if (startEditing && !isEditing) {
      isEditing = true;
      editValue = name;
      setTimeout(() => inputElement?.focus(), 0);
    }
  });

  let inputElement: HTMLInputElement;
  let isHovered = $state(false);
  let isDragging = $state(false);

  // Extract shell name from full path (e.g., /bin/zsh -> zsh)
  let shellName = $derived(shell ? (shell.split('/').pop() || shell) : '');

  // Truncate cwd to show last parts if too long
  let displayCwd = $derived(truncatePath(cwd, 25));

  // Show process badge only for non-shell processes
  const SHELL_NAMES = new Set(['sh', 'bash', 'zsh', 'fish', 'dash', 'ksh', 'csh', 'tcsh', 'ash', 'nu', 'pwsh', 'login']);
  let processBadge = $derived(foregroundProcess && !SHELL_NAMES.has(foregroundProcess) ? foregroundProcess : null);

  function truncatePath(path: string, maxLength: number): string {
    if (!path) return '';
    if (path.length <= maxLength) return path;
    const parts = path.split('/');
    let result = '';
    for (let i = parts.length - 1; i >= 0; i--) {
      const newResult = parts.slice(i).join('/');
      if (newResult.length > maxLength) {
        return '…/' + result;
      }
      result = newResult;
    }
    return result;
  }

  function handleClick() {
    if (!isEditing) {
      onselect?.(id);
    }
  }

  function handleDoubleClick() {
    isEditing = true;
    editValue = name;
    // Focus input after render
    setTimeout(() => inputElement?.focus(), 0);
  }

  function handleRename() {
    if (editValue.trim() && editValue !== name) {
      onrename?.({ id, newName: editValue.trim() });
    }
    isEditing = false;
    oneditend?.(id);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      handleRename();
    } else if (event.key === 'Escape') {
      isEditing = false;
      editValue = name;
      oneditend?.(id);
    }
  }

  function handleClose(event: MouseEvent) {
    event.stopPropagation();
    onclose?.(id);
  }

  function handleContextMenu(event: MouseEvent) {
    event.preventDefault();
    oncontextmenuprop?.({ id, x: event.clientX, y: event.clientY });
  }

  // Drag and drop handlers
  function handleDragStart(event: DragEvent) {
    if (isEditing) {
      event.preventDefault();
      return;
    }
    isDragging = true;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'copy';
      event.dataTransfer.setData('text/plain', id);
      // Set a drag image
      const target = event.target as HTMLElement;
      if (target) {
        event.dataTransfer.setDragImage(target, 0, 0);
      }
    }
  }

  function handleDragEnd() {
    isDragging = false;
  }
</script>

<div
  class="terminal-item"
  class:active={isActive}
  class:hovered={isHovered}
  class:dragging={isDragging}
  draggable="true"
  onclick={handleClick}
  ondblclick={handleDoubleClick}
  oncontextmenu={handleContextMenu}
  ondragstart={handleDragStart}
  ondragend={handleDragEnd}
  onmouseenter={() => isHovered = true}
  onmouseleave={() => isHovered = false}
  role="button"
  tabindex="0"
  onkeydown={(e) => e.key === 'Enter' && handleClick()}
>
  <div class="item-content">
    <div class="line-1">
      {#if isEditing}
        <input
          type="text"
          class="name-input"
          bind:value={editValue}
          bind:this={inputElement}
          onblur={handleRename}
          onkeydown={handleKeydown}
        />
      {:else}
        <span class="name">{name}</span>
      {/if}
      {#if processBadge}
        <span class="process-badge" title={foregroundProcess}>{processBadge}</span>
      {/if}
      {#each tags as tag}
        <span class="tag-badge" style="background: {tag.color}20; color: {tag.color}; border-color: {tag.color}40">{tag.name}</span>
      {/each}
      {#if paneCount > 0}
        <span class="pane-count" title="{paneCount} pane{paneCount > 1 ? 's' : ''}">
          {paneCount > 1 ? paneCount : ''}
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2 3h5v10H2V3zm7 0h5v10H9V3zM1 2a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1H1z"/>
          </svg>
        </span>
      {/if}
      {#if !isEditing}
        <button class="close-btn" class:visible={isHovered} onclick={handleClose} title="Close terminal">
          ×
        </button>
      {/if}
    </div>
    {#if terminalTitle}
      <div class="line-2 terminal-title" title={terminalTitle}>{terminalTitle}</div>
    {/if}
    <div class="line-2">
      <span class="shell">{shellName}</span>
      <span class="separator">·</span>
      <span class="cwd" title={cwd}>{displayCwd}</span>
    </div>
  </div>
</div>

<style>
  .terminal-item {
    padding: 8px 8px 8px 4px;
    margin: 2px 6px 2px 2px;
    border-radius: 4px;
    cursor: pointer;
    background: var(--ui-bg-secondary, #181a1c);
    border: 1px solid transparent;
    transition: background 0.1s, border-color 0.1s;
  }

  .terminal-item:hover,
  .terminal-item.hovered {
    background: var(--ui-bg-tertiary, #363636);
  }

  .terminal-item.active {
    background: var(--ui-bg-hover, #1e2022);
    box-shadow: inset 0 0 8px color-mix(in srgb, var(--ui-sidebar-active, #a0a7ff) 40%, transparent);
  }

  .terminal-item.dragging {
    opacity: 0.5;
  }

  .item-content {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .line-1 {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .name {
    font-size: 13px;
    color: var(--ui-text-primary, #fdfbfe);
    font-weight: 500;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .terminal-item.active .name {
    color: var(--ui-text-primary, white);
  }

  .name-input {
    flex: 1;
    background: var(--ui-bg-tertiary, #242629);
    border: 1px solid var(--ui-accent, #a0a7ff);
    border-radius: 2px;
    padding: 2px 4px;
    color: var(--ui-text-primary, white);
    font-size: 13px;
    outline: none;
  }

  .process-badge {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.08);
    color: #9a9a9a;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 80px;
    flex-shrink: 0;
  }

  .tag-badge {
    font-size: 9px;
    padding: 0px 5px;
    border-radius: 3px;
    border: 1px solid;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .terminal-item.active .process-badge {
    background: rgba(255, 255, 255, 0.12);
    color: #a0c0e0;
  }

  .pane-count {
    display: flex;
    align-items: center;
    gap: 2px;
    font-size: 10px;
    color: #808080;
    flex-shrink: 0;
  }

  .pane-count svg {
    opacity: 0.7;
  }

  .terminal-item.active .pane-count {
    color: #a0c0e0;
  }

  .close-btn {
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: #808080;
    cursor: pointer;
    border-radius: 4px;
    font-size: 16px;
    line-height: 1;
    padding: 0;
    opacity: 0;
    pointer-events: none;
  }

  .close-btn.visible {
    opacity: 1;
    pointer-events: auto;
  }

  .close-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: var(--ui-text-primary, white);
  }

  .line-2 {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: #808080;
  }

  .terminal-item.active .line-2 {
    color: #a0c0e0;
  }

  .shell {
    color: inherit;
  }

  .separator {
    color: inherit;
  }

  .cwd {
    color: inherit;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .terminal-title {
    color: var(--ui-text-primary, #fdfbfe);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .terminal-item.active .terminal-title {
    color: var(--ui-text-primary, white);
  }
</style>
