/**
 * Key Event Handler factory for terminar.
 *
 * Creates a handler function suitable for xterm's customKeyEventHandler.
 * It intercepts keydown events that match registered keybindings and
 * dispatches them, preventing the terminal from processing them.
 */

import type { KeyBindingRegistry } from './keybindings';

/**
 * Creates a key event handler for use with xterm's customKeyEventHandler.
 *
 * @param registry - The keybinding registry to match events against
 * @param dispatch - A function that dispatches an action string (returns true if handled)
 * @returns A function that returns false to prevent terminal handling, true to allow it
 */
export function createKeyEventHandler(
  registry: KeyBindingRegistry,
  dispatch: (action: string) => boolean,
): (event: KeyboardEvent) => boolean {
  return (event: KeyboardEvent): boolean => {
    // Only intercept keydown events; let everything else pass through
    if (event.type !== 'keydown') {
      return true;
    }

    const action = registry.match(event);
    if (action) {
      event.preventDefault();
      dispatch(action);
      return false; // Prevent terminal from processing this key
    }

    return true; // Allow terminal to process unmatched keys
  };
}
