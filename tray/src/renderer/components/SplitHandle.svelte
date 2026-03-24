<script lang="ts">
  import { startResize, endResize } from '../lib/resizeStore.svelte';

  let { direction, index, ondrag, oncommit }: {
    direction: 'horizontal' | 'vertical';
    index: number;
    ondrag?: (detail: { index: number; delta: number }) => void;
    oncommit?: () => void;
  } = $props();

  let isDragging = $state(false);
  let startPos = 0;

  function handlePointerDown(event: PointerEvent) {
    event.preventDefault();
    isDragging = true;
    startPos = direction === 'horizontal' ? event.clientX : event.clientY;

    // Capture all pointer events on this element (no window listeners needed)
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);

    // Signal that resize is starting (terminals will suspend fitting)
    startResize();
  }

  function handlePointerMove(event: PointerEvent) {
    if (!isDragging) return;

    const currentPos = direction === 'horizontal' ? event.clientX : event.clientY;
    const delta = currentPos - startPos;
    startPos = currentPos;

    ondrag?.({ index, delta });
  }

  function handlePointerUp(event: PointerEvent) {
    if (!isDragging) return;
    isDragging = false;

    (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);

    // Signal that resize has ended (terminals will now fit)
    endResize();

    oncommit?.();
  }
</script>

<div
  class="split-handle"
  class:horizontal={direction === 'horizontal'}
  class:vertical={direction === 'vertical'}
  class:dragging={isDragging}
  onpointerdown={handlePointerDown}
  onpointermove={handlePointerMove}
  onpointerup={handlePointerUp}
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
    touch-action: none;
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
