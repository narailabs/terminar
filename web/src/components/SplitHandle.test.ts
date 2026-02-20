import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import SplitHandle from './SplitHandle.svelte';

// ── Mock resizeStore ────────────────────────────────────────────────────────

vi.mock('../lib/resizeStore.svelte', () => ({
  startResize: vi.fn(),
  endResize: vi.fn(),
  resizeState: { isResizing: false },
}));

import { startResize, endResize } from '../lib/resizeStore.svelte';

describe('SplitHandle', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  /** Attach mock pointer-capture methods to an element (jsdom doesn't provide them). */
  function mockPointerCapture(el: Element) {
    (el as any).setPointerCapture = vi.fn();
    (el as any).releasePointerCapture = vi.fn();
  }

  // ── 1. Renders separator with correct horizontal class ──────────────────

  it('renders a separator with the horizontal class', () => {
    const { container } = render(SplitHandle, {
      props: { direction: 'horizontal', index: 0 },
    });

    const handle = container.querySelector('.split-handle');
    expect(handle).toBeTruthy();
    expect(handle?.classList.contains('horizontal')).toBe(true);
    expect(handle?.classList.contains('vertical')).toBe(false);
    expect(handle?.getAttribute('role')).toBe('separator');
  });

  // ── 2. Renders separator with correct vertical class ────────────────────

  it('renders a separator with the vertical class', () => {
    const { container } = render(SplitHandle, {
      props: { direction: 'vertical', index: 0 },
    });

    const handle = container.querySelector('.split-handle');
    expect(handle).toBeTruthy();
    expect(handle?.classList.contains('vertical')).toBe(true);
    expect(handle?.classList.contains('horizontal')).toBe(false);
  });

  // ── 3. Pointerdown calls startResize() and sets pointer capture ─────────

  it('pointerdown calls startResize and sets pointer capture', async () => {
    const { container } = render(SplitHandle, {
      props: { direction: 'horizontal', index: 0 },
    });

    const handle = container.querySelector('.split-handle')!;
    mockPointerCapture(handle);

    await fireEvent.pointerDown(handle, { clientX: 100, clientY: 100, pointerId: 1 });

    expect(startResize).toHaveBeenCalledTimes(1);
    expect((handle as any).setPointerCapture).toHaveBeenCalledWith(1);

    // Clean up: trigger pointerup
    await fireEvent.pointerUp(handle, { pointerId: 1 });
  });

  // ── 4. Pointermove during drag calls ondrag with delta (horizontal) ──

  it('calls ondrag with correct horizontal delta on pointermove', async () => {
    const dragHandler = vi.fn();
    const { container } = render(SplitHandle, {
      props: { direction: 'horizontal', index: 2, ondrag: dragHandler },
    });

    const handle = container.querySelector('.split-handle')!;
    mockPointerCapture(handle);

    // Start drag at clientX=100
    await fireEvent.pointerDown(handle, { clientX: 100, clientY: 50, pointerId: 1 });

    // Move to clientX=120 (delta = 20) — pointer capture routes to element
    await fireEvent.pointerMove(handle, { clientX: 120, clientY: 50, pointerId: 1 });

    expect(dragHandler).toHaveBeenCalledTimes(1);
    expect(dragHandler).toHaveBeenCalledWith({ index: 2, delta: 20 });

    // Move again to clientX=115 (delta = -5 from previous position 120)
    await fireEvent.pointerMove(handle, { clientX: 115, clientY: 50, pointerId: 1 });

    expect(dragHandler).toHaveBeenCalledTimes(2);
    expect(dragHandler).toHaveBeenLastCalledWith({ index: 2, delta: -5 });

    // Clean up
    await fireEvent.pointerUp(handle, { pointerId: 1 });
  });

  // ── 5. Pointermove during drag calls ondrag with delta (vertical) ────

  it('calls ondrag with correct vertical delta on pointermove', async () => {
    const dragHandler = vi.fn();
    const { container } = render(SplitHandle, {
      props: { direction: 'vertical', index: 1, ondrag: dragHandler },
    });

    const handle = container.querySelector('.split-handle')!;
    mockPointerCapture(handle);

    // Start drag at clientY=200
    await fireEvent.pointerDown(handle, { clientX: 50, clientY: 200, pointerId: 1 });

    // Move to clientY=230 (delta = 30)
    await fireEvent.pointerMove(handle, { clientX: 50, clientY: 230, pointerId: 1 });

    expect(dragHandler).toHaveBeenCalledTimes(1);
    expect(dragHandler).toHaveBeenCalledWith({ index: 1, delta: 30 });

    // Clean up
    await fireEvent.pointerUp(handle, { pointerId: 1 });
  });

  // ── 6. Pointerup calls endResize(), calls oncommit, releases capture ──

  it('pointerup calls endResize, calls oncommit, and releases pointer capture', async () => {
    const commitHandler = vi.fn();
    const { container } = render(SplitHandle, {
      props: { direction: 'horizontal', index: 0, oncommit: commitHandler },
    });

    const handle = container.querySelector('.split-handle')!;
    mockPointerCapture(handle);

    // Start drag
    await fireEvent.pointerDown(handle, { clientX: 100, clientY: 100, pointerId: 1 });

    // End drag
    await fireEvent.pointerUp(handle, { pointerId: 1 });

    expect(endResize).toHaveBeenCalledTimes(1);
    expect(commitHandler).toHaveBeenCalledTimes(1);
    expect((handle as any).releasePointerCapture).toHaveBeenCalledWith(1);
  });
});
