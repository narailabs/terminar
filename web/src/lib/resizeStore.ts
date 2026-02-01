/**
 * Store to track global resize state
 * Terminals should suspend fitting during active resize to prevent rendering glitches
 */

import { writable, derived } from 'svelte/store';

// Count of active resize operations (can have multiple if nested splits)
const activeResizeCount = writable(0);

/**
 * Whether any split handle is currently being dragged
 */
export const isResizing = derived(activeResizeCount, $count => $count > 0);

/**
 * Call when a resize drag starts
 */
export function startResize(): void {
  activeResizeCount.update(n => n + 1);
}

/**
 * Call when a resize drag ends
 */
export function endResize(): void {
  activeResizeCount.update(n => Math.max(0, n - 1));
}
