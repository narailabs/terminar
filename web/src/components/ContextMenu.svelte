<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  type MenuItem =
    | { type: 'separator' }
    | { label: string; action: string | (() => void); shortcut?: string; separator?: boolean; children?: MenuItem[] };

  let { x = 0, y = 0, items = [], onselect, onclose }: {
    x?: number;
    y?: number;
    items?: MenuItem[];
    onselect?: (action: string) => void;
    onclose?: () => void;
  } = $props();

  let menuElement: HTMLDivElement;

  function handleClick(item: MenuItem) {
    if ('type' in item && item.type === 'separator') return;

    const menuItem = item as { label: string; action: string | (() => void) };
    if (typeof menuItem.action === 'function') {
      menuItem.action();
      onclose?.();
    } else {
      onselect?.(menuItem.action);
    }
  }

  function handleClickOutside(event: MouseEvent) {
    if (menuElement && !menuElement.contains(event.target as Node)) {
      event.stopPropagation();
      event.preventDefault();
      onclose?.();
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      onclose?.();
    }
  }

  // Adjust position if menu would go off screen
  function adjustPosition(el: HTMLDivElement) {
    const rect = el.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    if (rect.right > viewportWidth) {
      el.style.left = `${viewportWidth - rect.width - 8}px`;
    }
    if (rect.bottom > viewportHeight) {
      el.style.top = `${viewportHeight - rect.height - 8}px`;
    }
  }

  onMount(() => {
    // Use mousedown in capture phase so we see the event before xterm.js
    // or other components can stop its propagation.
    document.addEventListener('mousedown', handleClickOutside, true);
    document.addEventListener('keydown', handleKeydown);
    if (menuElement) {
      adjustPosition(menuElement);
    }
  });

  onDestroy(() => {
    document.removeEventListener('mousedown', handleClickOutside, true);
    document.removeEventListener('keydown', handleKeydown);
  });

  function isSeparator(item: MenuItem): item is { type: 'separator' } {
    return ('type' in item && item.type === 'separator') || ('separator' in item && (item as any).separator === true);
  }

  // Type guard to get menu item with label
  function asMenuItem(item: MenuItem): { label: string; action: string | (() => void); shortcut?: string; children?: MenuItem[] } | null {
    if (isSeparator(item)) return null;
    return item as { label: string; action: string | (() => void); shortcut?: string; children?: MenuItem[] };
  }

  let openSubmenuLabel: string | null = $state(null);

  function adjustSubmenu(el: HTMLDivElement) {
    const rect = el.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    // Flip up if overflowing bottom
    if (rect.bottom > viewportHeight) {
      const overflow = rect.bottom - viewportHeight + 8;
      el.style.top = `${-overflow}px`;
    }

    // Flip to left side if overflowing right
    if (rect.right > viewportWidth) {
      el.style.left = 'auto';
      el.style.right = '100%';
    }
  }

  function handleSubmenuEnter(label: string) {
    openSubmenuLabel = label;
  }

  function handleSubmenuLeave() {
    openSubmenuLabel = null;
  }

  function handleSubmenuItemClick(child: MenuItem) {
    handleClick(child);
    openSubmenuLabel = null;
  }
</script>

<div
  class="context-menu"
  bind:this={menuElement}
  style="left: {x}px; top: {y}px;"
>
  {#each items as item}
    {#if isSeparator(item)}
      <div class="separator"></div>
    {:else}
      {@const menuItem = asMenuItem(item)}
      {#if menuItem}
        {#if menuItem.children && menuItem.children.length > 0}
          <div
            class="menu-item-wrapper"
            onmouseenter={() => handleSubmenuEnter(menuItem.label)}
            onmouseleave={handleSubmenuLeave}
          >
            <button class="menu-item has-submenu">
              <span class="menu-label">{menuItem.label}</span>
              <span class="submenu-arrow">&#x25B8;</span>
            </button>
            {#if openSubmenuLabel === menuItem.label}
              <div class="submenu" use:adjustSubmenu>
                {#each menuItem.children as child}
                  {#if isSeparator(child)}
                    <div class="separator"></div>
                  {:else}
                    {@const subItem = asMenuItem(child)}
                    {#if subItem}
                      <button class="menu-item" onclick={() => handleSubmenuItemClick(child)}>
                        <span class="menu-label">{subItem.label}</span>
                        {#if subItem.shortcut}
                          <span class="menu-shortcut">{subItem.shortcut}</span>
                        {/if}
                      </button>
                    {/if}
                  {/if}
                {/each}
              </div>
            {/if}
          </div>
        {:else}
          <button class="menu-item" onclick={() => handleClick(item)}>
            <span class="menu-label">{menuItem.label}</span>
            {#if menuItem.shortcut}
              <span class="menu-shortcut">{menuItem.shortcut}</span>
            {/if}
          </button>
        {/if}
      {/if}
    {/if}
  {/each}
</div>

<style>
  .context-menu {
    position: fixed;
    background: var(--ui-bg-secondary, #2d2d2d);
    border: 1px solid var(--ui-border, #454545);
    border-radius: 4px;
    padding: 4px 0;
    min-width: 180px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    z-index: 1000;
  }

  .menu-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 8px 16px;
    background: none;
    border: none;
    color: var(--ui-text-primary, #cccccc);
    text-align: left;
    cursor: pointer;
    font-size: 13px;
    gap: 16px;
  }

  .menu-item:hover {
    background: var(--ui-bg-hover, #094771);
    color: white;
  }

  .menu-label {
    flex: 1;
  }

  .menu-shortcut {
    font-size: 11px;
    color: var(--ui-text-muted, #888);
    white-space: nowrap;
  }

  .menu-item:hover .menu-shortcut {
    color: var(--ui-text-secondary, #bbb);
  }

  .menu-item-wrapper {
    position: relative;
  }

  .has-submenu {
    padding-right: 12px;
  }

  .submenu-arrow {
    font-size: 11px;
    color: var(--ui-text-muted, #888);
  }

  .menu-item:hover .submenu-arrow {
    color: var(--ui-text-secondary, #bbb);
  }

  .submenu {
    position: absolute;
    left: 100%;
    top: 0;
    background: var(--ui-bg-secondary, #2d2d2d);
    border: 1px solid var(--ui-border, #454545);
    border-radius: 4px;
    padding: 4px 0;
    min-width: 180px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    z-index: 1001;
  }

  .separator {
    height: 1px;
    background: var(--ui-border, #454545);
    margin: 4px 0;
  }
</style>
