import { describe, it, expect, afterEach } from 'vitest';
import { get } from 'svelte/store';
import { isResizing, startResize, endResize } from './resizeStore';

describe('resizeStore', () => {
  afterEach(() => {
    // Drain the counter back to 0. The clamp prevents going negative.
    for (let i = 0; i < 10; i++) {
      endResize();
    }
  });

  it('isResizing starts as false', () => {
    expect(get(isResizing)).toBe(false);
  });

  it('startResize sets isResizing to true', () => {
    startResize();
    expect(get(isResizing)).toBe(true);
  });

  it('endResize sets isResizing back to false', () => {
    startResize();
    expect(get(isResizing)).toBe(true);

    endResize();
    expect(get(isResizing)).toBe(false);
  });

  it('handles multiple nested resizes correctly', () => {
    startResize();
    startResize();
    expect(get(isResizing)).toBe(true);

    endResize();
    // Still resizing because count is 1
    expect(get(isResizing)).toBe(true);

    endResize();
    // Now count is 0, no longer resizing
    expect(get(isResizing)).toBe(false);
  });

  it('endResize clamps count to 0 and isResizing stays false', () => {
    // Already at 0, calling endResize should not go negative
    endResize();
    expect(get(isResizing)).toBe(false);

    endResize();
    expect(get(isResizing)).toBe(false);

    // Verify a subsequent startResize still works correctly
    startResize();
    expect(get(isResizing)).toBe(true);
  });

  it('clamp prevents negative count from affecting future resizes', () => {
    // Call endResize several times while at 0
    endResize();
    endResize();
    endResize();

    // A single startResize should set isResizing to true
    startResize();
    expect(get(isResizing)).toBe(true);

    // A single endResize should bring it back to false
    endResize();
    expect(get(isResizing)).toBe(false);
  });
});
