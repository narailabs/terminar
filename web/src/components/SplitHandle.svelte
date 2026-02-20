<script lang="ts">
  import { startResize, endResize } from '../lib/resizeStore.svelte';

  let { direction, index, onresize, onresizeend }: {
    direction: 'horizontal' | 'vertical';
    index: number;
    onresize?: (detail: { index: number; delta: number }) => void;
    onresizeend?: () => void;
  } = $props();

  let isDragging = $state(false);
  let startPos = 0;

  function handleMouseDown(event: MouseEvent) {
    event.preventDefault();
    isDragging = true;
    startPos = direction === 'horizontal' ? event.clientX : event.clientY;

    // Signal that resize is starting (terminals will suspend fitting)
    startResize();

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }

  function handleMouseMove(event: MouseEvent) {
    if (!isDragging) return;

    const currentPos = direction === 'horizontal' ? event.clientX : event.clientY;
    const delta = currentPos - startPos;
    startPos = currentPos;

    onresize?.({ index, delta });
  }

  function handleMouseUp() {
    isDragging = false;
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);

    // Signal that resize has ended (terminals will now fit)
    endResize();

    onresizeend?.();
  }
</script>

<div
  class="split-handle"
  class:horizontal={direction === 'horizontal'}
  class:vertical={direction === 'vertical'}
  class:dragging={isDragging}
  onmousedown={handleMouseDown}
  role="separator"
  aria-orientation={direction}
  tabindex="0"
></div>

<style>
  .split-handle {
    flex-shrink: 0;
    background: var(--ui-border, #3c3c3c);
    transition: background 0.15s;
    z-index: 10;
  }

  .split-handle:hover,
  .split-handle.dragging {
    background: var(--ui-accent, #0e639c);
  }

  .split-handle.horizontal {
    width: 4px;
    cursor: col-resize;
  }

  .split-handle.vertical {
    height: 4px;
    cursor: row-resize;
  }
</style>
