<svelte:options customElement="terminar-split" />

<script lang="ts">
  /**
   * <terminar-split> - Recursive split pane container web component.
   *
   * Renders a tree of split panes with draggable resize handles.
   * Context-free: resize commit is handled via callback prop.
   *
   * NOTE: In customElement mode, svelte:self recursion is handled
   * by importing the component itself. Consumer is responsible for
   * rendering pane content via slots or a render callback.
   */
  import TerminarSplit from './TerminarSplit.svelte';
  import TerminarSplitHandle from './TerminarSplitHandle.svelte';
  import type { SplitNode, SplitContainer as SplitContainerType } from '../lib/workspaceTypes';

  let {
    node,
    activePaneId = null,
    onresizecommit = undefined,
    onstartresize = undefined,
    onendresize = undefined,
  }: {
    node: SplitNode;
    activePaneId?: string | null;
    onresizecommit?: (splitId: string, ratios: number[]) => void;
    onstartresize?: () => void;
    onendresize?: () => void;
  } = $props();

  let containerRef: HTMLDivElement = $state(null!);
  let dragRatios: number[] | null = $state(null);

  function handleDrag(detail: { index: number; delta: number }) {
    if (node.type !== 'split' || !containerRef) return;
    const split = node as SplitContainerType;
    const { index, delta } = detail;

    if (!dragRatios) {
      dragRatios = [...split.ratios];
    }

    const rect = containerRef.getBoundingClientRect();
    const totalSize = split.direction === 'horizontal' ? rect.width : rect.height;
    const handleSize = 4;
    const numHandles = split.children.length - 1;
    const availableSize = totalSize - (handleSize * numHandles);
    const deltaRatio = delta / availableSize;
    const minRatio = 0.1;

    const newRatio1 = dragRatios[index] + deltaRatio;
    const newRatio2 = dragRatios[index + 1] - deltaRatio;

    if (newRatio1 >= minRatio && newRatio2 >= minRatio) {
      dragRatios[index] = newRatio1;
      dragRatios[index + 1] = newRatio2;

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
    onresizecommit?.(node.id, dragRatios);
    dragRatios = null;
  }

  function getFlexBasis(ratio: number, handleCount: number): string {
    const handleSize = 4;
    const handleTotal = handleSize * handleCount;
    return `calc(${ratio * 100}% - ${handleTotal * ratio}px)`;
  }
</script>

{#if node.type === 'pane'}
  <!-- Consumer renders pane content externally -->
  <div class="terminar-pane" data-pane-id={node.id} data-session-id={node.sessionId} data-active={activePaneId === node.id}>
    <slot name="pane" {node} isActive={activePaneId === node.id} />
  </div>
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
        <TerminarSplit
          node={child}
          {activePaneId}
          {onresizecommit}
          {onstartresize}
          {onendresize}
        />
      </div>
      {#if i < node.children.length - 1}
        <TerminarSplitHandle
          direction={node.direction}
          index={i}
          ondrag={(detail) => handleDrag(detail)}
          oncommit={() => handleCommit()}
          onstartresize={onstartresize}
          onendresize={onendresize}
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

  .terminar-pane {
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
</style>
