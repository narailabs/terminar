import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  KeyBindingRegistry,
  DEFAULT_KEYBINDINGS,
  ACTION_LABELS,
  formatBinding,
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

    it('should include Cmd-B (Meta) but not Ctrl-B for sidebar.toggle', () => {
      const bindings = registry.getBindingsForAction('sidebar.toggle');
      expect(bindings.some(b => b.key === 'b' && b.meta)).toBe(true);
      expect(bindings.some(b => b.key === 'b' && b.ctrl)).toBe(false);
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

  describe('formatBinding()', () => {
    beforeEach(() => {
      // Mock navigator.platform as Mac for consistent tests
      vi.stubGlobal('navigator', { platform: 'MacIntel' });
    });

    it('should format Cmd+B on Mac', () => {
      const result = formatBinding({ ctrl: false, shift: false, alt: false, meta: true, key: 'b' });
      expect(result).toBe('Cmd+B');
    });

    it('should format Ctrl+Shift+N', () => {
      const result = formatBinding({ ctrl: true, shift: true, alt: false, meta: false, key: 'N' });
      expect(result).toBe('Ctrl+Shift+N');
    });

    it('should format Cmd+F on Mac', () => {
      const result = formatBinding({ ctrl: false, shift: false, alt: false, meta: true, key: 'f' });
      expect(result).toBe('Cmd+F');
    });

    it('should format Alt as Option on Mac', () => {
      const result = formatBinding({ ctrl: false, shift: false, alt: true, meta: false, key: 'x' });
      expect(result).toBe('Option+X');
    });
  });

  describe('setOverride()', () => {
    it('should replace default bindings for an action', () => {
      registry.setOverride('sidebar.toggle', {
        key: 'j',
        ctrl: true,
        shift: false,
        alt: false,
        meta: false,
      });

      const bindings = registry.getBindingsForAction('sidebar.toggle');
      expect(bindings.length).toBe(1);
      expect(bindings[0].key).toBe('j');
      expect(bindings[0].ctrl).toBe(true);
    });

    it('should persist override to localStorage', () => {
      registry.setOverride('sidebar.toggle', {
        key: 'j',
        ctrl: true,
        shift: false,
        alt: false,
        meta: false,
      });

      expect(localStorage.setItem).toHaveBeenCalled();
      const stored = JSON.parse(mockStorage['terminar-keybindings']);
      expect(stored.some((b: KeyBinding) => b.key === 'j' && b.action === 'sidebar.toggle')).toBe(true);
    });

    it('should make the new binding matchable', () => {
      registry.setOverride('sidebar.toggle', {
        key: 'j',
        ctrl: true,
        shift: false,
        alt: false,
        meta: false,
      });

      const event = makeKeyEvent({ key: 'j', ctrlKey: true });
      expect(registry.match(event)).toBe('sidebar.toggle');
    });
  });

  describe('clearOverride()', () => {
    it('should revert to default bindings', () => {
      registry.setOverride('sidebar.toggle', {
        key: 'j',
        ctrl: true,
        shift: false,
        alt: false,
        meta: false,
      });

      registry.clearOverride('sidebar.toggle');

      const bindings = registry.getBindingsForAction('sidebar.toggle');
      const defaultBindings = DEFAULT_KEYBINDINGS.filter(b => b.action === 'sidebar.toggle');
      expect(bindings.length).toBe(defaultBindings.length);
    });

    it('should make default bindings matchable again', () => {
      registry.setOverride('sidebar.toggle', {
        key: 'j',
        ctrl: true,
        shift: false,
        alt: false,
        meta: false,
      });

      registry.clearOverride('sidebar.toggle');

      // Original Meta+B should work again
      const event = makeKeyEvent({ key: 'b', metaKey: true });
      expect(registry.match(event)).toBe('sidebar.toggle');
    });
  });

  describe('getEffectiveBindings()', () => {
    it('should return all actions from ACTION_LABELS', () => {
      const effective = registry.getEffectiveBindings();
      const actionNames = effective.map(e => e.action);
      for (const action of Object.keys(ACTION_LABELS)) {
        expect(actionNames).toContain(action);
      }
    });

    it('should mark defaults as not overridden', () => {
      const effective = registry.getEffectiveBindings();
      for (const entry of effective) {
        expect(entry.isOverridden).toBe(false);
      }
    });

    it('should mark overridden actions', () => {
      registry.setOverride('sidebar.toggle', {
        key: 'j',
        ctrl: true,
        shift: false,
        alt: false,
        meta: false,
      });

      const effective = registry.getEffectiveBindings();
      const sidebar = effective.find(e => e.action === 'sidebar.toggle');
      expect(sidebar?.isOverridden).toBe(true);
    });

    it('should include human-readable labels', () => {
      const effective = registry.getEffectiveBindings();
      const sidebar = effective.find(e => e.action === 'sidebar.toggle');
      expect(sidebar?.label).toBe('Toggle Sidebar');
    });
  });

  describe('getUserOverrides()', () => {
    it('should return empty array with no overrides', () => {
      expect(registry.getUserOverrides()).toEqual([]);
    });

    it('should return overridden bindings', () => {
      registry.setOverride('sidebar.toggle', {
        key: 'j',
        ctrl: true,
        shift: false,
        alt: false,
        meta: false,
      });

      const overrides = registry.getUserOverrides();
      expect(overrides.length).toBe(1);
      expect(overrides[0].action).toBe('sidebar.toggle');
      expect(overrides[0].key).toBe('j');
    });
  });
});
