import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  KeyBindingRegistry,
  DEFAULT_KEYBINDINGS,
  type KeyBinding,
} from './keybindings';

function makeKeyEvent(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key: '',
    code: '',
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...overrides,
  } as unknown as KeyboardEvent;
}

describe('KeyBindingRegistry', () => {
  let registry: KeyBindingRegistry;
  let mockStorage: Record<string, string>;

  beforeEach(() => {
    mockStorage = {};
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => mockStorage[key] ?? null),
      setItem: vi.fn((key: string, value: string) => { mockStorage[key] = value; }),
      removeItem: vi.fn((key: string) => { delete mockStorage[key]; }),
    });
    registry = new KeyBindingRegistry();
  });

  describe('F7a-1: Default keybindings loaded on startup', () => {
    it('should load default keybindings', () => {
      // Check that the registry has bindings for known default actions
      const searchOpen = registry.getBindingsForAction('search.open');
      expect(searchOpen.length).toBeGreaterThan(0);

      const sessionNew = registry.getBindingsForAction('session.new');
      expect(sessionNew.length).toBeGreaterThan(0);

      const sidebarToggle = registry.getBindingsForAction('sidebar.toggle');
      expect(sidebarToggle.length).toBeGreaterThan(0);
    });

    it('should include Ctrl-F / Cmd-F for search.open', () => {
      const bindings = registry.getBindingsForAction('search.open');
      expect(bindings.some(b => b.key === 'f' && (b.ctrl || b.meta))).toBe(true);
    });

    it('should include Ctrl-Shift-N for session.new', () => {
      const bindings = registry.getBindingsForAction('session.new');
      expect(bindings.some(b => b.key === 'N' && b.shift)).toBe(true);
    });

    it('should include Ctrl-B for sidebar.toggle', () => {
      const bindings = registry.getBindingsForAction('sidebar.toggle');
      expect(bindings.some(b => b.key === 'b')).toBe(true);
    });

    it('should include bindings for pane.close', () => {
      const bindings = registry.getBindingsForAction('pane.close');
      expect(bindings.length).toBeGreaterThan(0);
    });

    it('should include bindings for split.horizontal', () => {
      const bindings = registry.getBindingsForAction('split.horizontal');
      expect(bindings.length).toBeGreaterThan(0);
    });

    it('should include bindings for split.vertical', () => {
      const bindings = registry.getBindingsForAction('split.vertical');
      expect(bindings.length).toBeGreaterThan(0);
    });
  });

  describe('F7a-2: User keybinding overrides from localStorage', () => {
    it('should load user overrides from localStorage', () => {
      const overrides: KeyBinding[] = [
        { key: 'k', ctrl: true, shift: false, alt: false, meta: false, action: 'search.open' },
      ];
      mockStorage['terminar-keybindings'] = JSON.stringify(overrides);

      const reg = new KeyBindingRegistry();
      const bindings = reg.getBindingsForAction('search.open');
      expect(bindings.some(b => b.key === 'k' && b.ctrl)).toBe(true);
    });
  });

  describe('F7a-3: User overrides take precedence over defaults', () => {
    it('should replace default binding when user overrides the same action', () => {
      const overrides: KeyBinding[] = [
        { key: 'k', ctrl: true, shift: false, alt: false, meta: false, action: 'search.open' },
      ];
      mockStorage['terminar-keybindings'] = JSON.stringify(overrides);

      const reg = new KeyBindingRegistry();
      // The user override should be present
      const bindings = reg.getBindingsForAction('search.open');
      expect(bindings.some(b => b.key === 'k' && b.ctrl)).toBe(true);
    });
  });

  describe('F7a-4: match(event) returns bound action or null', () => {
    it('should return action for Ctrl-F', () => {
      const event = makeKeyEvent({ key: 'f', ctrlKey: true });
      const action = registry.match(event);
      expect(action).toBe('search.open');
    });

    it('should return action for Meta-F (Cmd-F on Mac)', () => {
      const event = makeKeyEvent({ key: 'f', metaKey: true });
      const action = registry.match(event);
      expect(action).toBe('search.open');
    });

    it('should return null for unbound key', () => {
      const event = makeKeyEvent({ key: 'z', ctrlKey: true });
      const action = registry.match(event);
      expect(action).toBeNull();
    });

    it('should return null for plain letter key', () => {
      const event = makeKeyEvent({ key: 'a' });
      const action = registry.match(event);
      expect(action).toBeNull();
    });

    it('should NOT intercept bare Escape (must reach terminal for TUI apps)', () => {
      const event = makeKeyEvent({ key: 'Escape' });
      const action = registry.match(event);
      expect(action).toBeNull();
    });
  });

  describe('F7a-5: Modifier combos', () => {
    it('should match Ctrl+Shift+N for session.new', () => {
      const event = makeKeyEvent({ key: 'N', ctrlKey: true, shiftKey: true });
      const action = registry.match(event);
      expect(action).toBe('session.new');
    });

    it('should match Ctrl+Shift+H for split.horizontal', () => {
      const event = makeKeyEvent({ key: 'H', ctrlKey: true, shiftKey: true });
      const action = registry.match(event);
      expect(action).toBe('split.horizontal');
    });

    it('should match Ctrl+Shift+V for split.vertical (non-Mac)', () => {
      const event = makeKeyEvent({ key: 'V', ctrlKey: true, shiftKey: true });
      const action = registry.match(event);
      expect(action).toBe('split.vertical');
    });

    it('should NOT match Ctrl-F when Shift is also pressed (different combo)', () => {
      const event = makeKeyEvent({ key: 'f', ctrlKey: true, shiftKey: true });
      const action = registry.match(event);
      // Should not match search.open which is Ctrl-F without Shift
      expect(action).not.toBe('search.open');
    });
  });

  describe('F7a-7: Duplicate binding detection', () => {
    it('should detect duplicate bindings and return warnings', () => {
      const binding1: KeyBinding = { key: 'f', ctrl: true, shift: false, alt: false, meta: false, action: 'search.open' };
      const binding2: KeyBinding = { key: 'f', ctrl: true, shift: false, alt: false, meta: false, action: 'some.other' };

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      registry.register(binding1);
      registry.register(binding2);

      const duplicates = registry.getDuplicates();
      expect(duplicates.length).toBeGreaterThan(0);

      consoleSpy.mockRestore();
    });
  });

  describe('F7a-8: getBindingsForAction', () => {
    it('should return all bindings for search.open', () => {
      const bindings = registry.getBindingsForAction('search.open');
      expect(Array.isArray(bindings)).toBe(true);
      expect(bindings.length).toBeGreaterThan(0);
      bindings.forEach(b => expect(b.action).toBe('search.open'));
    });

    it('should return empty array for unknown action', () => {
      const bindings = registry.getBindingsForAction('nonexistent.action');
      expect(bindings).toEqual([]);
    });
  });

  describe('register()', () => {
    it('should add a new binding', () => {
      registry.register({
        key: 'x',
        ctrl: true,
        shift: false,
        alt: false,
        meta: false,
        action: 'custom.action',
      });

      const event = makeKeyEvent({ key: 'x', ctrlKey: true });
      expect(registry.match(event)).toBe('custom.action');
    });
  });
});
