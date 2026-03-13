/**
 * Key Binding Registry for terminar
 *
 * Provides a centralized registry for keyboard shortcuts with:
 * - Default keybindings for common actions
 * - User override support via localStorage
 * - Duplicate binding detection
 * - Modifier combo support (Ctrl, Shift, Alt, Meta/Cmd)
 */

const STORAGE_KEY = 'terminar-keybindings';

export interface KeyBinding {
  key: string;       // The key value (e.g., 'f', 'Escape', 'N')
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  action: string;    // Action identifier (e.g., 'search.open')
}

/**
 * Default keybindings for terminar.
 * Both Ctrl and Meta variants are provided for cross-platform support.
 */
export const DEFAULT_KEYBINDINGS: KeyBinding[] = [
  // Search (Escape is handled directly by SearchBar and Pane, not here — bare Escape must reach the terminal for TUI apps)
  { key: 'f', ctrl: true, shift: false, alt: false, meta: false, action: 'search.open' },
  { key: 'f', ctrl: false, shift: false, alt: false, meta: true, action: 'search.open' },

  // Session management
  { key: 'N', ctrl: true, shift: true, alt: false, meta: false, action: 'session.new' },
  { key: 'N', ctrl: false, shift: true, alt: false, meta: true, action: 'session.new' },

  // Pane management
  { key: 'w', ctrl: true, shift: false, alt: false, meta: false, action: 'pane.close' },
  { key: 'w', ctrl: false, shift: false, alt: false, meta: true, action: 'pane.close' },

  // Sidebar (Cmd+B only — Ctrl+B must reach the terminal for tmux, nano, readline)
  { key: 'b', ctrl: false, shift: false, alt: false, meta: true, action: 'sidebar.toggle' },

  // Splits
  { key: 'H', ctrl: true, shift: true, alt: false, meta: false, action: 'split.horizontal' },
  { key: 'H', ctrl: false, shift: true, alt: false, meta: true, action: 'split.horizontal' },
  { key: 'V', ctrl: true, shift: true, alt: false, meta: false, action: 'split.vertical' },
  { key: 'V', ctrl: false, shift: true, alt: false, meta: true, action: 'split.vertical' },

  // Focus (zoom) pane
  { key: 'F', ctrl: true, shift: true, alt: false, meta: false, action: 'pane.focus' },
  { key: 'F', ctrl: false, shift: true, alt: false, meta: true, action: 'pane.focus' },
];

/**
 * Human-readable labels for each action.
 */
export const ACTION_LABELS: Record<string, string> = {
  'search.open': 'Search',
  'session.new': 'New Terminal',
  'pane.close': 'Close Pane',
  'sidebar.toggle': 'Toggle Sidebar',
  'split.horizontal': 'Split Right',
  'split.vertical': 'Split Down',
  'pane.focus': 'Focus Pane',
};

/**
 * Format a keybinding as a human-readable string (e.g., "Cmd+B" or "Ctrl+Shift+N").
 * Uses "Cmd" on macOS, "Ctrl" on other platforms.
 */
export function formatBinding(b: { ctrl: boolean; shift: boolean; alt: boolean; meta: boolean; key: string }): string {
  const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const parts: string[] = [];
  if (b.ctrl) parts.push(isMac ? 'Ctrl' : 'Ctrl');
  if (b.meta) parts.push(isMac ? 'Cmd' : 'Meta');
  if (b.alt) parts.push(isMac ? 'Option' : 'Alt');
  if (b.shift) parts.push('Shift');
  // Capitalize single-char keys for display
  const displayKey = b.key.length === 1 ? b.key.toUpperCase() : b.key;
  parts.push(displayKey);
  return parts.join('+');
}

/**
 * Generate a unique key string for a binding (excluding action) for duplicate detection.
 */
function bindingKey(b: { key: string; ctrl: boolean; shift: boolean; alt: boolean; meta: boolean }): string {
  const mods: string[] = [];
  if (b.ctrl) mods.push('ctrl');
  if (b.shift) mods.push('shift');
  if (b.alt) mods.push('alt');
  if (b.meta) mods.push('meta');
  mods.push(b.key);
  return mods.join('+');
}

export class KeyBindingRegistry {
  private bindings: KeyBinding[] = [];

  constructor() {
    // Load defaults
    this.bindings = [...DEFAULT_KEYBINDINGS];

    // Load user overrides from localStorage
    this.loadUserOverrides();
  }

  private loadUserOverrides(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const overrides: KeyBinding[] = JSON.parse(raw);
        if (Array.isArray(overrides)) {
          // User overrides are added on top of defaults.
          // If a user override targets the same action, the user's binding
          // is added alongside defaults (user can match via either).
          for (const override of overrides) {
            this.bindings.push(override);
          }
        }
      }
    } catch (e) {
      console.warn('[KeyBindings] Failed to load user overrides:', e);
    }
  }

  /**
   * Register a new key binding. Warns about duplicates.
   */
  register(binding: KeyBinding): void {
    const key = bindingKey(binding);
    const existing = this.bindings.find(b => bindingKey(b) === key && b.action !== binding.action);
    if (existing) {
      console.warn(
        `[KeyBindings] Duplicate binding: ${key} is bound to both "${existing.action}" and "${binding.action}"`
      );
    }
    this.bindings.push(binding);
  }

  /**
   * Match a keyboard event against registered bindings.
   * Returns the action string if a match is found, null otherwise.
   */
  match(event: KeyboardEvent): string | null {
    for (const binding of this.bindings) {
      if (
        event.key === binding.key &&
        event.ctrlKey === binding.ctrl &&
        event.shiftKey === binding.shift &&
        event.altKey === binding.alt &&
        event.metaKey === binding.meta
      ) {
        return binding.action;
      }
    }
    return null;
  }

  /**
   * Get all bindings for a given action.
   */
  getBindingsForAction(action: string): KeyBinding[] {
    return this.bindings.filter(b => b.action === action);
  }

  /**
   * Get all registered bindings.
   */
  getAllBindings(): KeyBinding[] {
    return [...this.bindings];
  }

  /**
   * Detect duplicate bindings (same key combo mapped to different actions).
   * Returns an array of descriptive warning strings.
   */
  getDuplicates(): string[] {
    const keyMap = new Map<string, string[]>();
    for (const binding of this.bindings) {
      const key = bindingKey(binding);
      if (!keyMap.has(key)) {
        keyMap.set(key, []);
      }
      const actions = keyMap.get(key)!;
      if (!actions.includes(binding.action)) {
        actions.push(binding.action);
      }
    }

    const duplicates: string[] = [];
    for (const [key, actions] of keyMap) {
      if (actions.length > 1) {
        duplicates.push(`${key} is bound to: ${actions.join(', ')}`);
      }
    }
    return duplicates;
  }

  /**
   * Save user overrides to localStorage.
   */
  saveUserOverrides(overrides: KeyBinding[]): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
    } catch (e) {
      console.warn('[KeyBindings] Failed to save user overrides:', e);
    }
  }

  /**
   * Set a user override for an action. Replaces all default bindings for that action
   * with the given binding, and persists to localStorage.
   */
  setOverride(action: string, binding: Omit<KeyBinding, 'action'>): void {
    // Remove all existing bindings for this action
    this.bindings = this.bindings.filter(b => b.action !== action);
    // Add the new binding
    const fullBinding: KeyBinding = { ...binding, action };
    this.bindings.push(fullBinding);
    // Persist: store only the user-overridden bindings (those differing from defaults)
    this.persistOverrides();
  }

  /**
   * Clear user override for an action, reverting to default bindings.
   */
  clearOverride(action: string): void {
    // Remove all current bindings for this action
    this.bindings = this.bindings.filter(b => b.action !== action);
    // Restore defaults for this action
    const defaults = DEFAULT_KEYBINDINGS.filter(b => b.action === action);
    this.bindings.push(...defaults);
    // Persist
    this.persistOverrides();
  }

  /**
   * Get current user overrides (bindings that differ from defaults).
   */
  getUserOverrides(): KeyBinding[] {
    const defaultKeys = new Set(DEFAULT_KEYBINDINGS.map(b => bindingKey(b) + ':' + b.action));
    return this.bindings.filter(b => !defaultKeys.has(bindingKey(b) + ':' + b.action));
  }

  /**
   * Get a merged view of all actions with their effective bindings.
   */
  getEffectiveBindings(): { action: string; label: string; bindings: KeyBinding[]; isOverridden: boolean }[] {
    const actions = Object.keys(ACTION_LABELS);
    return actions.map(action => {
      const bindings = this.getBindingsForAction(action);
      const defaultBindings = DEFAULT_KEYBINDINGS.filter(b => b.action === action);
      const isOverridden = bindings.length !== defaultBindings.length ||
        bindings.some(b => !defaultBindings.find(d =>
          bindingKey(d) === bindingKey(b)
        ));
      return {
        action,
        label: ACTION_LABELS[action] || action,
        bindings,
        isOverridden,
      };
    });
  }

  /**
   * Persist current overrides to localStorage.
   */
  private persistOverrides(): void {
    const overrides = this.getUserOverrides();
    this.saveUserOverrides(overrides);
  }
}

/**
 * Singleton registry instance for use across the app.
 */
let _instance: KeyBindingRegistry | null = null;

export function getKeyBindingRegistry(): KeyBindingRegistry {
  if (!_instance) {
    _instance = new KeyBindingRegistry();
  }
  return _instance;
}

/**
 * Reset the singleton (useful for testing).
 */
export function resetKeyBindingRegistry(): void {
  _instance = null;
}
