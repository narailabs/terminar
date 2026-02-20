<script lang="ts">
  import Pane from './Pane.svelte';
  import SplitHandle from './SplitHandle.svelte';
  import type { SplitNode, SplitContainer as SplitContainerType, DropZone, SessionId, PaneId } from '../lib/workspaceTypes';

  let {
    node,
    activePaneId = null,
    ondrop,
    onpaneDrop,
    oncontextmenu,
    onfocus,
    onresize,
    ondetach,
    onkill,
    onActionPaneClose,
    onActionSplitHorizontal,
    onActionSplitVertical,
  }: {
    node: SplitNode;
    activePaneId?: PaneId | null;
    ondrop?: (detail: { paneId: string; sessionId: SessionId; dropZone: DropZone }) => void;
    onpaneDrop?: (detail: { sourcePaneId: string; targetPaneId: string; dropZone: DropZone }) => void;
    oncontextmenu?: (detail: { paneId: string; x: number; y: number }) => void;
    onfocus?: (detail: { paneId: string }) => void;
    onresize?: (detail: { splitId: string; ratios: number[] }) => void;
    ondetach?: (detail: { paneId: string }) => void;
    onkill?: (detail: { paneId: string; sessionId: SessionId }) => void;
    onActionPaneClose?: (detail: { paneId: string }) => void;
    onActionSplitHorizontal?: (detail: { paneId: string }) => void;
    onActionSplitVertical?: (detail: { paneId: string }) => void;
  } = $props();

  let containerRef: HTMLDivElement;

  function handleSplitResize(detail: { index: number; delta: number }) {
    if (node.type !== 'split' || !containerRef) return;

    const split = node as SplitContainerType;
    const { index, delta } = detail;

    // Get container dimensions
    const rect = containerRef.getBoundingClientRect();
    const totalSize = split.direction === 'horizontal' ? rect.width : rect.height;

    // Handle size is 4px
    const handleSize = 4;
    const numHandles = split.children.length - 1;
    const availableSize = totalSize - (handleSize * numHandles);

    // Convert delta to ratio change
    const deltaRatio = delta / availableSize;

    // Update ratios
    const newRatios = [...split.ratios];

    // Ensure we don't go below minimum (10% of available space per pane)
    const minRatio = 0.1;

    const newRatio1 = newRatios[index] + deltaRatio;
    const newRatio2 = newRatios[index + 1] - deltaRatio;

    if (newRatio1 >= minRatio && newRatio2 >= minRatio) {
      newRatios[index] = newRatio1;
      newRatios[index + 1] = newRatio2;
      onresize?.({ splitId: split.id, ratios: newRatios });
    }
  }

  function handleResizeEnd() {
    // Could trigger a save here if needed
  }

  // Calculate flex basis for each child
  function getFlexBasis(ratio: number, handleCount: number): string {
    // Account for handle sizes in the flex basis calculation
    const handleSize = 4;
    const handleTotal = handleSize * handleCount;
    return `calc(${ratio * 100}% - ${handleTotal * ratio}px)`;
  }
</script>

{#if node.type === 'pane'}
  <Pane
    paneId={node.id}
    sessionId={node.sessionId}
    isActive={activePaneId === node.id}
    ondrop={(detail) => ondrop?.(detail)}
    onpaneDrop={(detail) => onpaneDrop?.(detail)}
    oncontextmenu={(detail) => oncontextmenu?.(detail)}
    onfocus={(detail) => onfocus?.(detail)}
    ondetach={(detail) => ondetach?.(detail)}
    onkill={(detail) => onkill?.(detail)}
    onActionPaneClose={(detail) => onActionPaneClose?.(detail)}
    onActionSplitHorizontal={(detail) => onActionSplitHorizontal?.(detail)}
    onActionSplitVertical={(detail) => onActionSplitVertical?.(detail)}
  />
{:else}
  <div
    class="split-container"
    class:horizontal={node.direction === 'horizontal'}
    class:vertical={node.direction === 'vertical'}
    bind:this={containerRef}
  >
    {#each node.children as child, i}
      <div
        class="split-child"
        style="flex: 0 0 {getFlexBasis(node.ratios[i], node.children.length - 1)};"
      >
        <svelte:self
          node={child}
          {activePaneId}
          ondrop={(detail) => ondrop?.(detail)}
          onpaneDrop={(detail) => onpaneDrop?.(detail)}
          oncontextmenu={(detail) => oncontextmenu?.(detail)}
          onfocus={(detail) => onfocus?.(detail)}
          onresize={(detail) => onresize?.(detail)}
          ondetach={(detail) => ondetach?.(detail)}
          onkill={(detail) => onkill?.(detail)}
          onActionPaneClose={(detail) => onActionPaneClose?.(detail)}
          onActionSplitHorizontal={(detail) => onActionSplitHorizontal?.(detail)}
          onActionSplitVertical={(detail) => onActionSplitVertical?.(detail)}
        />
      </div>
      {#if i < node.children.length - 1}
        <SplitHandle
          direction={node.direction}
          index={i}
          onresize={(detail) => handleSplitResize(detail)}
          onresizeend={() => handleResizeEnd()}
        />
      {/if}
    {/each}
  </div>
{/if}

<style>
  .split-container {
    display: flex;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  .split-container.horizontal {
    flex-direction: row;
  }

  .split-container.vertical {
    flex-direction: column;
  }

  .split-child {
    overflow: hidden;
    min-width: 100px;
    min-height: 50px;
  }
</style>
