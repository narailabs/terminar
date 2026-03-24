import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
})();
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

// We need to dynamically import after mocking localStorage
let themeStore: typeof import('./themeStore.svelte');

describe('themeStore', () => {
  beforeEach(async () => {
    vi.resetModules();
    localStorageMock.clear();
    // Clean up any CSS variables from previous tests
    const root = document.documentElement;
    Array.from(root.style).forEach((prop) => {
      if (prop.startsWith('--ui-') || prop.startsWith('--term-')) {
        root.style.removeProperty(prop);
      }
    });
    themeStore = await import('./themeStore.svelte');
  });

  // ── Default state ────────────────────────────────────────────────────────

  it('should initialize with dark theme as default', () => {
    const state = themeStore.themeState.value;
    expect(state.uiMode).toBe('dark');
    expect(state.activeUIThemeId).toBe('dark');
    expect(state.activeTerminalThemeId).toBe('dark');
  });

  it('should have empty custom themes and overrides by default', () => {
    const state = themeStore.themeState.value;
    expect(state.customUIThemes).toEqual([]);
    expect(state.customTerminalThemes).toEqual([]);
    expect(state.terminalOverrides).toEqual({});
  });

  // ── Setting active themes ────────────────────────────────────────────────

  it('should set active UI theme', () => {
    themeStore.setActiveUITheme('light');
    expect(themeStore.themeState.value.activeUIThemeId).toBe('light');
  });

  it('should set active terminal theme', () => {
    themeStore.setActiveTerminalTheme('dark-green');
    expect(themeStore.themeState.value.activeTerminalThemeId).toBe('dark-green');
  });

  // ── Per-pane terminal overrides ──────────────────────────────────────────

  it('should set a per-pane terminal override', () => {
    themeStore.setTerminalOverride('pane-1', 'light');
    expect(themeStore.themeState.value.terminalOverrides['pane-1']).toBe('light');
  });

  it('should clear a per-pane terminal override', () => {
    themeStore.setTerminalOverride('pane-1', 'light');
    themeStore.clearTerminalOverride('pane-1');
    expect(themeStore.themeState.value.terminalOverrides['pane-1']).toBeUndefined();
  });

  // ── getTerminalTheme helper ──────────────────────────────────────────────

  it('getTerminalTheme should return global theme when no override', () => {
    themeStore.setActiveTerminalTheme('dark');
    const theme = themeStore.getTerminalTheme('pane-1');
    expect(theme.id).toBe('dark');
  });

  it('getTerminalTheme should return override theme when set', () => {
    themeStore.setActiveTerminalTheme('dark');
    themeStore.setTerminalOverride('pane-1', 'light');
    const theme = themeStore.getTerminalTheme('pane-1');
    expect(theme.id).toBe('light');
  });

  it('getTerminalTheme should fall back to global if override id is invalid', () => {
    themeStore.setActiveTerminalTheme('dark');
    themeStore.setTerminalOverride('pane-1', 'nonexistent');
    const theme = themeStore.getTerminalTheme('pane-1');
    expect(theme.id).toBe('dark');
  });

  // ── CSS variable application ─────────────────────────────────────────────

  it('should apply CSS variables to document.documentElement on UI theme change', () => {
    themeStore.setActiveUITheme('light');
    themeStore.applyUIThemeCSS();
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--ui-bg-primary')).toBe('#ffffff');
    expect(root.style.getPropertyValue('--ui-text-primary')).toBe('#333333');
  });

  it('should update CSS variables when switching themes', () => {
    themeStore.setActiveUITheme('dark');
    themeStore.applyUIThemeCSS();
    expect(document.documentElement.style.getPropertyValue('--ui-bg-primary')).toBe('#1e1e1e');

    themeStore.setActiveUITheme('light');
    themeStore.applyUIThemeCSS();
    expect(document.documentElement.style.getPropertyValue('--ui-bg-primary')).toBe('#ffffff');
  });

  // ── Resolved theme helpers ───────────────────────────────────────────────

  it('getActiveUITheme should return the resolved UITheme object', () => {
    themeStore.setActiveUITheme('light');
    const theme = themeStore.getActiveUITheme();
    expect(theme.id).toBe('light');
    expect(theme.name).toBe('Light');
  });

  it('getActiveTerminalTheme should return the resolved TerminalTheme object', () => {
    themeStore.setActiveTerminalTheme('light');
    const theme = themeStore.getActiveTerminalTheme();
    expect(theme.id).toBe('light');
    expect(theme.name).toBe('Light');
  });

  // ── Custom themes ────────────────────────────────────────────────────────

  it('should add a custom UI theme', () => {
    const custom = {
      id: 'my-ui',
      name: 'My Theme',
      bgPrimary: '#111',
      bgSecondary: '#222',
      bgTertiary: '#333',
      bgHover: '#444',
      bgActive: '#555',
      textPrimary: '#eee',
      textSecondary: '#ccc',
      textMuted: '#999',
      border: '#444',
      accent: '#0ff',
      accentHover: '#0ee',
      destructive: '#f00',
      destructiveHover: '#e00',
    };
    themeStore.addCustomUITheme(custom);
    expect(themeStore.themeState.value.customUIThemes).toHaveLength(1);
    expect(themeStore.themeState.value.customUIThemes[0].id).toBe('my-ui');
  });

  it('should add a custom terminal theme', () => {
    const custom = {
      id: 'my-term',
      name: 'My Terminal',
      foreground: '#0f0',
      background: '#000',
      cursor: '#0f0',
      cursorAccent: '#000',
      selectionBackground: '#030',
      selectionForeground: '#0f0',
      selectionInactiveBackground: '#020',
      ansi: {
        black: '#000', red: '#f00', green: '#0f0', yellow: '#ff0',
        blue: '#00f', magenta: '#f0f', cyan: '#0ff', white: '#fff',
        brightBlack: '#555', brightRed: '#f55', brightGreen: '#5f5', brightYellow: '#ff5',
        brightBlue: '#55f', brightMagenta: '#f5f', brightCyan: '#5ff', brightWhite: '#fff',
      },
    };
    themeStore.addCustomTerminalTheme(custom);
    expect(themeStore.themeState.value.customTerminalThemes).toHaveLength(1);
  });

  it('should delete a custom UI theme and fall back if active', () => {
    const custom = {
      id: 'to-delete',
      name: 'Delete Me',
      bgPrimary: '#111', bgSecondary: '#222', bgTertiary: '#333',
      bgHover: '#444', bgActive: '#555',
      textPrimary: '#eee', textSecondary: '#ccc', textMuted: '#999',
      border: '#444', accent: '#0ff', accentHover: '#0ee',
      destructive: '#f00', destructiveHover: '#e00',
    };
    themeStore.addCustomUITheme(custom);
    themeStore.setActiveUITheme('to-delete');
    expect(themeStore.themeState.value.activeUIThemeId).toBe('to-delete');

    themeStore.deleteCustomUITheme('to-delete');
    expect(themeStore.themeState.value.customUIThemes).toHaveLength(0);
    expect(themeStore.themeState.value.activeUIThemeId).toBe('dark');
  });

  it('should update a custom UI theme in place', () => {
    const custom = {
      id: 'update-ui',
      name: 'Original',
      bgPrimary: '#111', bgSecondary: '#222', bgTertiary: '#333',
      bgHover: '#444', bgActive: '#555',
      textPrimary: '#eee', textSecondary: '#ccc', textMuted: '#999',
      border: '#444', accent: '#0ff', accentHover: '#0ee',
      destructive: '#f00', destructiveHover: '#e00',
    };
    themeStore.addCustomUITheme(custom);
    expect(themeStore.themeState.value.customUIThemes[0].name).toBe('Original');

    themeStore.updateCustomUITheme('update-ui', { ...custom, name: 'Updated' });
    expect(themeStore.themeState.value.customUIThemes).toHaveLength(1);
    expect(themeStore.themeState.value.customUIThemes[0].name).toBe('Updated');
    expect(themeStore.themeState.value.customUIThemes[0].id).toBe('update-ui');
  });

  it('should update a custom terminal theme in place', () => {
    const custom = {
      id: 'update-term',
      name: 'Original',
      foreground: '#0f0', background: '#000', cursor: '#0f0', cursorAccent: '#000',
      selectionBackground: '#030', selectionForeground: '#0f0', selectionInactiveBackground: '#020',
      ansi: {
        black: '#000', red: '#f00', green: '#0f0', yellow: '#ff0',
        blue: '#00f', magenta: '#f0f', cyan: '#0ff', white: '#fff',
        brightBlack: '#555', brightRed: '#f55', brightGreen: '#5f5', brightYellow: '#ff5',
        brightBlue: '#55f', brightMagenta: '#f5f', brightCyan: '#5ff', brightWhite: '#fff',
      },
    };
    themeStore.addCustomTerminalTheme(custom);
    expect(themeStore.themeState.value.customTerminalThemes[0].name).toBe('Original');

    themeStore.updateCustomTerminalTheme('update-term', { ...custom, name: 'Updated', foreground: '#fff' });
    expect(themeStore.themeState.value.customTerminalThemes).toHaveLength(1);
    expect(themeStore.themeState.value.customTerminalThemes[0].name).toBe('Updated');
    expect(themeStore.themeState.value.customTerminalThemes[0].foreground).toBe('#fff');
  });

  it('should delete a custom terminal theme and clear overrides using it', () => {
    const custom = {
      id: 'to-delete-term',
      name: 'Delete Me',
      foreground: '#0f0', background: '#000', cursor: '#0f0', cursorAccent: '#000',
      selectionBackground: '#030', selectionForeground: '#0f0', selectionInactiveBackground: '#020',
      ansi: {
        black: '#000', red: '#f00', green: '#0f0', yellow: '#ff0',
        blue: '#00f', magenta: '#f0f', cyan: '#0ff', white: '#fff',
        brightBlack: '#555', brightRed: '#f55', brightGreen: '#5f5', brightYellow: '#ff5',
        brightBlue: '#55f', brightMagenta: '#f5f', brightCyan: '#5ff', brightWhite: '#fff',
      },
    };
    themeStore.addCustomTerminalTheme(custom);
    themeStore.setTerminalOverride('pane-1', 'to-delete-term');

    themeStore.deleteCustomTerminalTheme('to-delete-term');
    expect(themeStore.themeState.value.customTerminalThemes).toHaveLength(0);
    expect(themeStore.themeState.value.terminalOverrides['pane-1']).toBeUndefined();
  });

  // ── Persistence ──────────────────────────────────────────────────────────

  it('should persist state to localStorage on changes', () => {
    localStorageMock.setItem.mockClear();
    themeStore.setActiveUITheme('light');
    expect(localStorageMock.setItem).toHaveBeenCalled();
    const calls = localStorageMock.setItem.mock.calls.filter(
      (c: string[]) => c[0] === 'theme-state'
    );
    expect(calls.length).toBeGreaterThan(0);
    const parsed = JSON.parse(calls[calls.length - 1][1]);
    expect(parsed.activeUIThemeId).toBe('light');
  });

  it('should restore state from localStorage on init', async () => {
    const saved = {
      uiMode: 'light' as const,
      activeUIThemeId: 'light',
      activeTerminalThemeId: 'dark-green',
      terminalOverrides: { 'p1': 'dark' },
      customUIThemes: [],
      customTerminalThemes: [],
    };
    localStorageMock.setItem('theme-state', JSON.stringify(saved));

    vi.resetModules();
    const freshStore = await import('./themeStore.svelte');
    const state = freshStore.themeState.value;
    expect(state.uiMode).toBe('light');
    expect(state.activeUIThemeId).toBe('light');
    expect(state.activeTerminalThemeId).toBe('dark-green');
    expect(state.terminalOverrides['p1']).toBe('dark');
  });

  // ── UI Mode ─────────────────────────────────────────────────────────────

  it('setUIMode should update uiMode and activeUIThemeId', () => {
    themeStore.setUIMode('light');
    const state = themeStore.themeState.value;
    expect(state.uiMode).toBe('light');
    expect(state.activeUIThemeId).toBe('light');
  });

  it('setUIMode dark should set activeUIThemeId to dark', () => {
    themeStore.setUIMode('dark');
    const state = themeStore.themeState.value;
    expect(state.uiMode).toBe('dark');
    expect(state.activeUIThemeId).toBe('dark');
  });

  it('setUIMode auto should resolve based on matchMedia', () => {
    const matchMediaMock = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal('matchMedia', matchMediaMock);

    themeStore.setUIMode('auto');
    const state = themeStore.themeState.value;
    expect(state.uiMode).toBe('auto');
    // matches=false -> light
    expect(state.activeUIThemeId).toBe('light');

    vi.unstubAllGlobals();
  });

  it('setUIMode auto should resolve to dark when OS prefers dark', () => {
    const matchMediaMock = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal('matchMedia', matchMediaMock);

    themeStore.setUIMode('auto');
    const state = themeStore.themeState.value;
    expect(state.uiMode).toBe('auto');
    expect(state.activeUIThemeId).toBe('dark');

    vi.unstubAllGlobals();
  });

  it('getResolvedUIMode should return light or dark for auto', () => {
    const matchMediaMock = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal('matchMedia', matchMediaMock);

    themeStore.setUIMode('auto');
    const resolved = themeStore.getResolvedUIMode();
    expect(resolved).toBe('light');

    vi.unstubAllGlobals();
  });

  it('getResolvedUIMode should return the mode for non-auto', () => {
    themeStore.setUIMode('dark');
    expect(themeStore.getResolvedUIMode()).toBe('dark');
    themeStore.setUIMode('light');
    expect(themeStore.getResolvedUIMode()).toBe('light');
  });

  // ── Migration ─────────────────────────────────────────────────────────

  it('should migrate old state without uiMode to dark', async () => {
    const saved = {
      activeUIThemeId: 'dark',
      activeTerminalThemeId: 'dark',
      terminalOverrides: {},
      customUIThemes: [],
      customTerminalThemes: [],
    };
    localStorageMock.setItem('theme-state', JSON.stringify(saved));

    vi.resetModules();
    const freshStore = await import('./themeStore.svelte');
    const state = freshStore.themeState.value;
    expect(state.uiMode).toBe('dark');
  });

  it('should migrate old state with light activeUIThemeId to uiMode light', async () => {
    const saved = {
      activeUIThemeId: 'light',
      activeTerminalThemeId: 'dark',
      terminalOverrides: {},
      customUIThemes: [],
      customTerminalThemes: [],
    };
    localStorageMock.setItem('theme-state', JSON.stringify(saved));

    vi.resetModules();
    const freshStore = await import('./themeStore.svelte');
    const state = freshStore.themeState.value;
    expect(state.uiMode).toBe('light');
  });

  it('should migrate old state with dark-green activeUIThemeId to dark', async () => {
    const saved = {
      activeUIThemeId: 'dark-green',
      activeTerminalThemeId: 'dark',
      terminalOverrides: {},
      customUIThemes: [],
      customTerminalThemes: [],
    };
    localStorageMock.setItem('theme-state', JSON.stringify(saved));

    vi.resetModules();
    const freshStore = await import('./themeStore.svelte');
    const state = freshStore.themeState.value;
    expect(state.uiMode).toBe('dark');
    expect(state.activeUIThemeId).toBe('dark');
  });
});
