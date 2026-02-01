<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { startResize, endResize } from '../lib/resizeStore';

  export let direction: 'horizontal' | 'vertical';
  export let index: number;

  const dispatch = createEventDispatcher<{
    resize: { index: number; delta: number };
    resizeEnd: void;
  }>();

  let isDragging = false;
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

    dispatch('resize', { index, delta });
  }

  function handleMouseUp() {
    isDragging = false;
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);

    // Signal that resize has ended (terminals will now fit)
    endResize();

    dispatch('resizeEnd');
  }
</script>

<div
  class="split-handle"
  class:horizontal={direction === 'horizontal'}
  class:vertical={direction === 'vertical'}
  class:dragging={isDragging}
  on:mousedown={handleMouseDown}
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
