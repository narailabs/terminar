<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export let id: string;
  export let name: string;
  export let shell: string;
  export let cwd: string;
  export let foregroundProcess: string | null = null;
  export let isActive: boolean = false;
  export let startEditing: boolean = false;

  const dispatch = createEventDispatcher();

  let isEditing = false;
  let editValue = name;

  // React to external edit trigger
  $: if (startEditing && !isEditing) {
    isEditing = true;
    editValue = name;
    setTimeout(() => inputElement?.focus(), 0);
  }
  let inputElement: HTMLInputElement;
  let isHovered = false;
  let isDragging = false;

  // Extract shell name from full path (e.g., /bin/zsh -> zsh)
  $: shellName = shell ? (shell.split('/').pop() || shell) : '';

  // Truncate cwd to show last parts if too long
  $: displayCwd = truncatePath(cwd, 25);

  // Show process badge when foreground process differs from the shell
  $: processBadge = foregroundProcess && foregroundProcess !== shellName ? foregroundProcess : null;

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
      dispatch('select', id);
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
      dispatch('rename', { id, newName: editValue.trim() });
    }
    isEditing = false;
    dispatch('editend', id);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      handleRename();
    } else if (event.key === 'Escape') {
      isEditing = false;
      editValue = name;
      dispatch('editend', id);
    }
  }

  function handleClose(event: MouseEvent) {
    event.stopPropagation();
    dispatch('close', id);
  }

  function handleContextMenu(event: MouseEvent) {
    event.preventDefault();
    dispatch('contextmenu', { id, x: event.clientX, y: event.clientY });
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
  on:click={handleClick}
  on:dblclick={handleDoubleClick}
  on:contextmenu={handleContextMenu}
  on:dragstart={handleDragStart}
  on:dragend={handleDragEnd}
  on:mouseenter={() => isHovered = true}
  on:mouseleave={() => isHovered = false}
  role="button"
  tabindex="0"
  on:keydown={(e) => e.key === 'Enter' && handleClick()}
>
  <div class="item-content">
    <div class="line-1">
      {#if isEditing}
        <input
          type="text"
          class="name-input"
          bind:value={editValue}
          bind:this={inputElement}
          on:blur={handleRename}
          on:keydown={handleKeydown}
        />
      {:else}
        <span class="name">{name}</span>
      {/if}
      {#if processBadge}
        <span class="process-badge" title={foregroundProcess}>{processBadge}</span>
      {/if}
      {#if isHovered && !isEditing}
        <button class="close-btn" on:click={handleClose} title="Close terminal">
          ×
        </button>
      {/if}
    </div>
    <div class="line-2">
      <span class="shell">{shellName}</span>
      <span class="separator">·</span>
      <span class="cwd" title={cwd}>{displayCwd}</span>
    </div>
  </div>
</div>

<style>
  .terminal-item {
    padding: 8px 12px;
    margin: 2px 8px;
    border-radius: 4px;
    cursor: pointer;
    background: var(--ui-bg-secondary, #2d2d2d);
    border: 1px solid transparent;
    transition: background 0.1s, border-color 0.1s;
  }

  .terminal-item:hover,
  .terminal-item.hovered {
    background: var(--ui-bg-tertiary, #363636);
  }

  .terminal-item.active {
    background: var(--ui-bg-hover, #094771);
    border-color: var(--ui-accent, #0e639c);
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
    color: var(--ui-text-primary, #cccccc);
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
    background: var(--ui-bg-tertiary, #3c3c3c);
    border: 1px solid var(--ui-accent, #0e639c);
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

  .terminal-item.active .process-badge {
    background: rgba(255, 255, 255, 0.12);
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
</style>
