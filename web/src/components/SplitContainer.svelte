<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import Pane from './Pane.svelte';
  import SplitHandle from './SplitHandle.svelte';
  import type { SessionManager } from '../lib/SessionManager';
  import type { SplitNode, SplitContainer as SplitContainerType, DropZone, SessionId, PaneId } from '../lib/workspaceTypes';

  export let node: SplitNode;
  export let manager: SessionManager | null = null;
  export let activePaneId: PaneId | null = null;

  const dispatch = createEventDispatcher<{
    drop: { paneId: string; sessionId: SessionId; dropZone: DropZone };
    contextmenu: { paneId: string; x: number; y: number };
    focus: { paneId: string };
    resize: { splitId: string; ratios: number[] };
    detach: { paneId: string };
    kill: { paneId: string; sessionId: SessionId };
  }>();

  let containerRef: HTMLDivElement;

  function handlePaneDrop(event: CustomEvent<{ paneId: string; sessionId: SessionId; dropZone: DropZone }>) {
    dispatch('drop', event.detail);
  }

  function handlePaneContextMenu(event: CustomEvent<{ paneId: string; x: number; y: number }>) {
    dispatch('contextmenu', event.detail);
  }

  function handlePaneFocus(event: CustomEvent<{ paneId: string }>) {
    dispatch('focus', event.detail);
  }

  function handlePaneDetach(event: CustomEvent<{ paneId: string }>) {
    dispatch('detach', event.detail);
  }

  function handlePaneKill(event: CustomEvent<{ paneId: string; sessionId: SessionId }>) {
    dispatch('kill', event.detail);
  }

  function handleSplitResize(event: CustomEvent<{ index: number; delta: number }>) {
    if (node.type !== 'split' || !containerRef) return;

    const split = node as SplitContainerType;
    const { index, delta } = event.detail;

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
      dispatch('resize', { splitId: split.id, ratios: newRatios });
    }
  }

  function handleResizeEnd() {
    // Could trigger a save here if needed
  }

  // Recursive handler for nested splits
  function handleNestedResize(event: CustomEvent<{ splitId: string; ratios: number[] }>) {
    dispatch('resize', event.detail);
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
    {manager}
    isActive={activePaneId === node.id}
    on:drop={handlePaneDrop}
    on:contextmenu={handlePaneContextMenu}
    on:focus={handlePaneFocus}
    on:detach={handlePaneDetach}
    on:kill={handlePaneKill}
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
          {manager}
          {activePaneId}
          on:drop={handlePaneDrop}
          on:contextmenu={handlePaneContextMenu}
          on:focus={handlePaneFocus}
          on:resize={handleNestedResize}
          on:detach={handlePaneDetach}
          on:kill={handlePaneKill}
        />
      </div>
      {#if i < node.children.length - 1}
        <SplitHandle
          direction={node.direction}
          index={i}
          on:resize={handleSplitResize}
          on:resizeEnd={handleResizeEnd}
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
