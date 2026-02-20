import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

  // ── 3. Mousedown calls startResize() and sets up window listeners ───────

  it('mousedown calls startResize and registers window listeners', async () => {
    const addSpy = vi.spyOn(window, 'addEventListener');

    const { container } = render(SplitHandle, {
      props: { direction: 'horizontal', index: 0 },
    });

    const handle = container.querySelector('.split-handle')!;
    await fireEvent.mouseDown(handle, { clientX: 100, clientY: 100 });

    expect(startResize).toHaveBeenCalledTimes(1);

    // Should have added mousemove and mouseup listeners on window
    const addedEvents = addSpy.mock.calls.map((call) => call[0]);
    expect(addedEvents).toContain('mousemove');
    expect(addedEvents).toContain('mouseup');

    // Clean up: trigger mouseup to remove listeners
    await fireEvent.mouseUp(window);
    addSpy.mockRestore();
  });

  // ── 4. Mousemove during drag calls onresize with delta (horizontal) ──

  it('calls onresize with correct horizontal delta on mousemove', async () => {
    const resizeHandler = vi.fn();
    const { container } = render(SplitHandle, {
      props: { direction: 'horizontal', index: 2, onresize: resizeHandler },
    });

    const handle = container.querySelector('.split-handle')!;

    // Start drag at clientX=100
    await fireEvent.mouseDown(handle, { clientX: 100, clientY: 50 });

    // Move to clientX=120 (delta = 20)
    await fireEvent.mouseMove(window, { clientX: 120, clientY: 50 });

    expect(resizeHandler).toHaveBeenCalledTimes(1);
    expect(resizeHandler).toHaveBeenCalledWith({ index: 2, delta: 20 });

    // Move again to clientX=115 (delta = -5 from previous position 120)
    await fireEvent.mouseMove(window, { clientX: 115, clientY: 50 });

    expect(resizeHandler).toHaveBeenCalledTimes(2);
    expect(resizeHandler).toHaveBeenLastCalledWith({ index: 2, delta: -5 });

    // Clean up
    await fireEvent.mouseUp(window);
  });

  // ── 5. Mousemove during drag calls onresize with delta (vertical) ────

  it('calls onresize with correct vertical delta on mousemove', async () => {
    const resizeHandler = vi.fn();
    const { container } = render(SplitHandle, {
      props: { direction: 'vertical', index: 1, onresize: resizeHandler },
    });

    const handle = container.querySelector('.split-handle')!;

    // Start drag at clientY=200
    await fireEvent.mouseDown(handle, { clientX: 50, clientY: 200 });

    // Move to clientY=230 (delta = 30)
    await fireEvent.mouseMove(window, { clientX: 50, clientY: 230 });

    expect(resizeHandler).toHaveBeenCalledTimes(1);
    expect(resizeHandler).toHaveBeenCalledWith({ index: 1, delta: 30 });

    // Clean up
    await fireEvent.mouseUp(window);
  });

  // ── 6. Mouseup calls endResize(), calls onresizeend, removes listeners

  it('mouseup calls endResize, calls onresizeend, and removes window listeners', async () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const resizeEndHandler = vi.fn();
    const { container } = render(SplitHandle, {
      props: { direction: 'horizontal', index: 0, onresizeend: resizeEndHandler },
    });

    const handle = container.querySelector('.split-handle')!;

    // Start drag
    await fireEvent.mouseDown(handle, { clientX: 100, clientY: 100 });

    // End drag
    await fireEvent.mouseUp(window);

    expect(endResize).toHaveBeenCalledTimes(1);
    expect(resizeEndHandler).toHaveBeenCalledTimes(1);

    // Should have removed mousemove and mouseup listeners from window
    const removedEvents = removeSpy.mock.calls.map((call) => call[0]);
    expect(removedEvents).toContain('mousemove');
    expect(removedEvents).toContain('mouseup');

    removeSpy.mockRestore();
  });
});
