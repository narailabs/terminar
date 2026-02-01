/**
 * Key Binding Registry for termiNar
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
 * Default keybindings for termiNar.
 * Both Ctrl and Meta variants are provided for cross-platform support.
 */
export const DEFAULT_KEYBINDINGS: KeyBinding[] = [
  // Search
  { key: 'f', ctrl: true, shift: false, alt: false, meta: false, action: 'search.open' },
  { key: 'f', ctrl: false, shift: false, alt: false, meta: true, action: 'search.open' },
  { key: 'Escape', ctrl: false, shift: false, alt: false, meta: false, action: 'search.close' },

  // Session management
  { key: 'N', ctrl: true, shift: true, alt: false, meta: false, action: 'session.new' },
  { key: 'N', ctrl: false, shift: true, alt: false, meta: true, action: 'session.new' },

  // Pane management
  { key: 'w', ctrl: true, shift: false, alt: false, meta: false, action: 'pane.close' },
  { key: 'w', ctrl: false, shift: false, alt: false, meta: true, action: 'pane.close' },

  // Sidebar
  { key: 'b', ctrl: true, shift: false, alt: false, meta: false, action: 'sidebar.toggle' },
  { key: 'b', ctrl: false, shift: false, alt: false, meta: true, action: 'sidebar.toggle' },

  // Splits
  { key: 'H', ctrl: true, shift: true, alt: false, meta: false, action: 'split.horizontal' },
  { key: 'H', ctrl: false, shift: true, alt: false, meta: true, action: 'split.horizontal' },
  { key: 'V', ctrl: true, shift: true, alt: false, meta: false, action: 'split.vertical' },
  { key: 'V', ctrl: false, shift: true, alt: false, meta: true, action: 'split.vertical' },
];

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
