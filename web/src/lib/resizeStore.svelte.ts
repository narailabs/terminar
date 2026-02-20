/**
 * Store to track global resize state
 * Terminals should suspend fitting during active resize to prevent rendering glitches
 */

// Count of active resize operations (can have multiple if nested splits)
let activeResizeCount = $state(0);

/**
 * Reactive resize state.
 * Access `resizeState.isResizing` in components — it will re-evaluate reactively.
 */
export const resizeState = {
  get isResizing() {
    return activeResizeCount > 0;
  },
};

/**
 * Call when a resize drag starts
 */
export function startResize(): void {
  activeResizeCount++;
}

/**
 * Call when a resize drag ends
 */
export function endResize(): void {
  activeResizeCount = Math.max(0, activeResizeCount - 1);
}
