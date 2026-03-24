<svelte:options customElement="terminar-split-handle" />

<script lang="ts">
  let { direction, index, ondrag, oncommit, onstartresize, onendresize }: {
    direction: 'horizontal' | 'vertical';
    index: number;
    ondrag?: (detail: { index: number; delta: number }) => void;
    oncommit?: () => void;
    onstartresize?: () => void;
    onendresize?: () => void;
  } = $props();

  let isDragging = $state(false);
  let startPos = 0;

  function handlePointerDown(event: PointerEvent) {
    event.preventDefault();
    isDragging = true;
    startPos = direction === 'horizontal' ? event.clientX : event.clientY;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    onstartresize?.();
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
    onendresize?.();
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
