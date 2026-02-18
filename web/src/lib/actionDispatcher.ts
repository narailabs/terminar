/**
 * Action Dispatcher for terminar keybindings.
 *
 * Maps keybinding action strings (e.g., 'search.open') to callable callback functions.
 */

export interface ActionCallbacks {
  onSearchOpen: () => void;
  onSearchClose: () => void;
  onSessionNew: () => void;
  onSidebarToggle: () => void;
  onPaneClose: () => void;
  onSplitHorizontal: () => void;
  onSplitVertical: () => void;
}

const ACTION_MAP: Record<string, keyof ActionCallbacks> = {
  'search.open': 'onSearchOpen',
  'search.close': 'onSearchClose',
  'session.new': 'onSessionNew',
  'sidebar.toggle': 'onSidebarToggle',
  'pane.close': 'onPaneClose',
  'split.horizontal': 'onSplitHorizontal',
  'split.vertical': 'onSplitVertical',
};

/**
 * Creates a dispatcher function that maps action strings to callbacks.
 * Returns true if the action was handled, false if unknown.
 */
export function createActionDispatcher(callbacks: ActionCallbacks): (action: string) => boolean {
  return (action: string): boolean => {
    const callbackKey = ACTION_MAP[action];
    if (callbackKey) {
      callbacks[callbackKey]();
      return true;
    }
    return false;
  };
}
