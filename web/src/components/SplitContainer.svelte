<script lang="ts">
  import Pane from './Pane.svelte';
  import SplitHandle from './SplitHandle.svelte';
  import type { SplitNode, SplitContainer as SplitContainerType, PaneId } from '../lib/workspaceTypes';
  import { getPaneActionsContext } from '../lib/sessionContext.svelte';

  let {
    node,
    activePaneId = null,
  }: {
    node: SplitNode;
    activePaneId?: PaneId | null;
  } = $props();

  const paneActions = getPaneActionsContext();

  let containerRef: HTMLDivElement;

  // Local drag state — non-null only while actively dragging
  let dragRatios: number[] | null = $state(null);

  function handleDrag(detail: { index: number; delta: number }) {
    if (node.type !== 'split' || !containerRef) return;

    const split = node as SplitContainerType;
    const { index, delta } = detail;

    // Lazily initialize from the store's ratios on first drag event
    if (!dragRatios) {
      dragRatios = [...split.ratios];
    }

    // Get container dimensions
    const rect = containerRef.getBoundingClientRect();
    const totalSize = split.direction === 'horizontal' ? rect.width : rect.height;

    // Handle size is 4px
    const handleSize = 4;
    const numHandles = split.children.length - 1;
    const availableSize = totalSize - (handleSize * numHandles);

    // Convert delta to ratio change
    const deltaRatio = delta / availableSize;

    // Ensure we don't go below minimum (10% of available space per pane)
    const minRatio = 0.1;

    const newRatio1 = dragRatios[index] + deltaRatio;
    const newRatio2 = dragRatios[index + 1] - deltaRatio;

    if (newRatio1 >= minRatio && newRatio2 >= minRatio) {
      dragRatios[index] = newRatio1;
      dragRatios[index + 1] = newRatio2;

      // Apply directly to DOM for smooth drag (bypass store)
      const children = containerRef.querySelectorAll<HTMLElement>(':scope > .split-child');
      const handleCount = split.children.length - 1;
      children.forEach((child, i) => {
        if (i < dragRatios!.length) {
          child.style.flex = `0 0 ${getFlexBasis(dragRatios![i], handleCount)}`;
        }
      });
    }
  }

  function handleCommit() {
    if (node.type !== 'split' || !dragRatios) return;
    paneActions.commitResize(node.id, dragRatios);
    dragRatios = null;
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
        />
      </div>
      {#if i < node.children.length - 1}
        <SplitHandle
          direction={node.direction}
          index={i}
          ondrag={(detail) => handleDrag(detail)}
          oncommit={() => handleCommit()}
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
