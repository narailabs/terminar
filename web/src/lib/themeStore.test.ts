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
    expect(document.documentElement.style.getPropertyValue('--ui-bg-primary')).toBe('#0d0e10');

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
      scrollbarThumb: 'rgba(100,100,100,0.4)',
      scrollbarThumbHover: 'rgba(100,100,100,0.7)',
      tabActive: '#0ff',
      paneBorderActive: '#0ff',
      sidebarActive: '#0ff',
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
      fontSize: 14,
      fontFamily: 'Menlo',
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
      scrollbarThumb: 'rgba(100,100,100,0.4)', scrollbarThumbHover: 'rgba(100,100,100,0.7)',
      tabActive: '#0ff', paneBorderActive: '#0ff', sidebarActive: '#0ff',
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
      scrollbarThumb: 'rgba(100,100,100,0.4)', scrollbarThumbHover: 'rgba(100,100,100,0.7)',
      tabActive: '#0ff', paneBorderActive: '#0ff', sidebarActive: '#0ff',
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
      fontSize: 14, fontFamily: 'Menlo',
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
      fontSize: 14, fontFamily: 'Menlo',
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

// ── Server sync ───────────────────────────────────────────────────────────

describe('themeStore server sync', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    localStorageMock.clear();
    themeStore = await import('./themeStore.svelte');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('initializeFromServer should update state when server returns data', () => {
    const serverState = {
      uiMode: 'light' as const,
      activeUIThemeId: 'light',
      activeTerminalThemeId: 'light',
      terminalOverrides: {},
      customUIThemes: [],
      customTerminalThemes: [],
    };
    themeStore.initializeFromServer(serverState);
    expect(themeStore.themeState.value.uiMode).toBe('light');
    expect(themeStore.themeState.value.activeUIThemeId).toBe('light');
    expect(themeStore.themeState.value.activeTerminalThemeId).toBe('light');
  });

  it('initializeFromServer should update localStorage cache', () => {
    localStorageMock.setItem.mockClear();
    const serverState = {
      uiMode: 'light' as const,
      activeUIThemeId: 'light',
      activeTerminalThemeId: 'light',
      terminalOverrides: {},
      customUIThemes: [],
      customTerminalThemes: [],
    };
    themeStore.initializeFromServer(serverState);
    const calls = localStorageMock.setItem.mock.calls.filter(
      (c: string[]) => c[0] === 'theme-state'
    );
    expect(calls.length).toBeGreaterThan(0);
  });

  it('initializeFromServer with null should preserve existing state', () => {
    themeStore.setActiveTerminalTheme('dark-green');
    themeStore.initializeFromServer(null);
    expect(themeStore.themeState.value.activeTerminalThemeId).toBe('dark-green');
  });

  it('setSaveCallback should register a server save function', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    themeStore.setSaveCallback(saveFn);

    themeStore.setActiveTerminalTheme('light');
    vi.advanceTimersByTime(500);

    // Allow the async callback to resolve
    await vi.runAllTimersAsync();
    expect(saveFn).toHaveBeenCalledTimes(1);
    expect(saveFn).toHaveBeenCalledWith(
      expect.objectContaining({ activeTerminalThemeId: 'light' })
    );
  });

  it('scheduleSave should debounce server saves', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    themeStore.setSaveCallback(saveFn);

    themeStore.setActiveTerminalTheme('light');
    themeStore.setActiveTerminalTheme('dark-green');
    themeStore.setActiveTerminalTheme('dark');

    vi.advanceTimersByTime(500);
    await vi.runAllTimersAsync();

    // Only the last save should fire
    expect(saveFn).toHaveBeenCalledTimes(1);
    expect(saveFn).toHaveBeenCalledWith(
      expect.objectContaining({ activeTerminalThemeId: 'dark' })
    );
  });

  it('scheduleSave should write localStorage immediately on each change', () => {
    themeStore.setSaveCallback(vi.fn().mockResolvedValue(undefined));
    localStorageMock.setItem.mockClear();

    themeStore.setActiveTerminalTheme('light');
    themeStore.setActiveTerminalTheme('dark-green');

    const calls = localStorageMock.setItem.mock.calls.filter(
      (c: string[]) => c[0] === 'theme-state'
    );
    // Each change should write to localStorage immediately
    expect(calls.length).toBe(2);
  });

  it('themeStoreApi should expose initialize and setSaveCallback', () => {
    expect(themeStore.themeStoreApi).toBeDefined();
    expect(typeof themeStore.themeStoreApi.initialize).toBe('function');
    expect(typeof themeStore.themeStoreApi.setSaveCallback).toBe('function');
  });
});

// ── Built-in override system ─────────────────────────────────────────────

describe('themeStore built-in overrides', () => {
  beforeEach(async () => {
    vi.resetModules();
    localStorageMock.clear();
    themeStore = await import('./themeStore.svelte');
  });

  it('findUITheme should return custom override over built-in with same ID', () => {
    const override = {
      id: 'dark',
      name: 'My Dark',
      bgPrimary: '#111111', bgSecondary: '#222', bgTertiary: '#333',
      bgHover: '#444', bgActive: '#555',
      textPrimary: '#eee', textSecondary: '#ccc', textMuted: '#999',
      border: '#444', accent: '#0ff', accentHover: '#0ee',
      destructive: '#f00', destructiveHover: '#e00',
      scrollbarThumb: 'rgba(100,100,100,0.4)', scrollbarThumbHover: 'rgba(100,100,100,0.7)',
      tabActive: '#0ff', paneBorderActive: '#0ff', sidebarActive: '#0ff',
    };
    themeStore.addCustomUITheme(override);
    themeStore.setActiveUITheme('dark');
    const resolved = themeStore.getActiveUITheme();
    expect(resolved.bgPrimary).toBe('#111111');
    expect(resolved.name).toBe('My Dark');
  });

  it('findTerminalTheme should return custom override over built-in with same ID', () => {
    const override = {
      id: 'dark-green',
      name: 'My Green',
      foreground: '#00ff00', background: '#0a0a0a', cursor: '#00ff00', cursorAccent: '#0a0a0a',
      selectionBackground: '#1a3a1a', selectionForeground: '#33ff33', selectionInactiveBackground: '#1a2a1a',
      ansi: {
        black: '#000', red: '#f00', green: '#0f0', yellow: '#ff0',
        blue: '#00f', magenta: '#f0f', cyan: '#0ff', white: '#fff',
        brightBlack: '#555', brightRed: '#f55', brightGreen: '#5f5', brightYellow: '#ff5',
        brightBlue: '#55f', brightMagenta: '#f5f', brightCyan: '#5ff', brightWhite: '#fff',
      },
      fontSize: 16, fontFamily: 'Monaco',
    };
    themeStore.addCustomTerminalTheme(override);
    themeStore.setActiveTerminalTheme('dark-green');
    const resolved = themeStore.getActiveTerminalTheme();
    expect(resolved.foreground).toBe('#00ff00');
    expect(resolved.name).toBe('My Green');
  });

  it('upsertCustomUITheme should add when no existing custom theme has that ID', () => {
    const theme = {
      id: 'dark',
      name: 'Dark Override',
      bgPrimary: '#111', bgSecondary: '#222', bgTertiary: '#333',
      bgHover: '#444', bgActive: '#555',
      textPrimary: '#eee', textSecondary: '#ccc', textMuted: '#999',
      border: '#444', accent: '#0ff', accentHover: '#0ee',
      destructive: '#f00', destructiveHover: '#e00',
      scrollbarThumb: 'rgba(100,100,100,0.4)', scrollbarThumbHover: 'rgba(100,100,100,0.7)',
      tabActive: '#0ff', paneBorderActive: '#0ff', sidebarActive: '#0ff',
    };
    themeStore.upsertCustomUITheme(theme);
    expect(themeStore.themeState.value.customUIThemes).toHaveLength(1);
    expect(themeStore.themeState.value.customUIThemes[0].name).toBe('Dark Override');
  });

  it('upsertCustomUITheme should update when a custom theme with that ID already exists', () => {
    const theme = {
      id: 'dark',
      name: 'Dark Override',
      bgPrimary: '#111', bgSecondary: '#222', bgTertiary: '#333',
      bgHover: '#444', bgActive: '#555',
      textPrimary: '#eee', textSecondary: '#ccc', textMuted: '#999',
      border: '#444', accent: '#0ff', accentHover: '#0ee',
      destructive: '#f00', destructiveHover: '#e00',
      scrollbarThumb: 'rgba(100,100,100,0.4)', scrollbarThumbHover: 'rgba(100,100,100,0.7)',
      tabActive: '#0ff', paneBorderActive: '#0ff', sidebarActive: '#0ff',
    };
    themeStore.upsertCustomUITheme(theme);
    themeStore.upsertCustomUITheme({ ...theme, bgPrimary: '#222222' });
    expect(themeStore.themeState.value.customUIThemes).toHaveLength(1);
    expect(themeStore.themeState.value.customUIThemes[0].bgPrimary).toBe('#222222');
  });

  it('isBuiltInOverridden should return false when no override exists', () => {
    expect(themeStore.isBuiltInOverridden('dark')).toBe(false);
    expect(themeStore.isBuiltInOverridden('dark-green')).toBe(false);
  });

  it('isBuiltInOverridden should return true when custom theme has built-in ID', () => {
    const override = {
      id: 'dark-green',
      name: 'Dark Green',
      foreground: '#00ff00', background: '#0a0a0a', cursor: '#00ff00', cursorAccent: '#0a0a0a',
      selectionBackground: '#1a3a1a', selectionForeground: '#33ff33', selectionInactiveBackground: '#1a2a1a',
      ansi: {
        black: '#000', red: '#f00', green: '#0f0', yellow: '#ff0',
        blue: '#00f', magenta: '#f0f', cyan: '#0ff', white: '#fff',
        brightBlack: '#555', brightRed: '#f55', brightGreen: '#5f5', brightYellow: '#ff5',
        brightBlue: '#55f', brightMagenta: '#f5f', brightCyan: '#5ff', brightWhite: '#fff',
      },
      fontSize: 14, fontFamily: 'Menlo',
    };
    themeStore.addCustomTerminalTheme(override);
    expect(themeStore.isBuiltInOverridden('dark-green')).toBe(true);
  });

  it('isBuiltInOverridden should return false for custom-prefixed ID', () => {
    const custom = {
      id: 'custom-123',
      name: 'Custom',
      bgPrimary: '#111', bgSecondary: '#222', bgTertiary: '#333',
      bgHover: '#444', bgActive: '#555',
      textPrimary: '#eee', textSecondary: '#ccc', textMuted: '#999',
      border: '#444', accent: '#0ff', accentHover: '#0ee',
      destructive: '#f00', destructiveHover: '#e00',
      scrollbarThumb: 'rgba(100,100,100,0.4)', scrollbarThumbHover: 'rgba(100,100,100,0.7)',
      tabActive: '#0ff', paneBorderActive: '#0ff', sidebarActive: '#0ff',
    };
    themeStore.addCustomUITheme(custom);
    expect(themeStore.isBuiltInOverridden('custom-123')).toBe(false);
  });

  it('resetBuiltInOverride should remove custom themes with the given built-in ID', () => {
    const uiOverride = {
      id: 'dark',
      name: 'Dark',
      bgPrimary: '#111', bgSecondary: '#222', bgTertiary: '#333',
      bgHover: '#444', bgActive: '#555',
      textPrimary: '#eee', textSecondary: '#ccc', textMuted: '#999',
      border: '#444', accent: '#0ff', accentHover: '#0ee',
      destructive: '#f00', destructiveHover: '#e00',
      scrollbarThumb: 'rgba(100,100,100,0.4)', scrollbarThumbHover: 'rgba(100,100,100,0.7)',
      tabActive: '#0ff', paneBorderActive: '#0ff', sidebarActive: '#0ff',
    };
    const termOverride = {
      id: 'dark',
      name: 'Dark',
      foreground: '#fff', background: '#000', cursor: '#fff', cursorAccent: '#000',
      selectionBackground: '#333', selectionForeground: '#fff', selectionInactiveBackground: '#222',
      ansi: {
        black: '#000', red: '#f00', green: '#0f0', yellow: '#ff0',
        blue: '#00f', magenta: '#f0f', cyan: '#0ff', white: '#fff',
        brightBlack: '#555', brightRed: '#f55', brightGreen: '#5f5', brightYellow: '#ff5',
        brightBlue: '#55f', brightMagenta: '#f5f', brightCyan: '#5ff', brightWhite: '#fff',
      },
      fontSize: 14, fontFamily: 'Menlo',
    };
    themeStore.addCustomUITheme(uiOverride);
    themeStore.addCustomTerminalTheme(termOverride);
    expect(themeStore.isBuiltInOverridden('dark')).toBe(true);

    themeStore.resetBuiltInOverride('dark');
    expect(themeStore.themeState.value.customUIThemes).toHaveLength(0);
    expect(themeStore.themeState.value.customTerminalThemes).toHaveLength(0);
    expect(themeStore.isBuiltInOverridden('dark')).toBe(false);
  });

  it('resetBuiltInOverride should NOT change active theme IDs', () => {
    const termOverride = {
      id: 'dark',
      name: 'Dark',
      foreground: '#fff', background: '#000', cursor: '#fff', cursorAccent: '#000',
      selectionBackground: '#333', selectionForeground: '#fff', selectionInactiveBackground: '#222',
      ansi: {
        black: '#000', red: '#f00', green: '#0f0', yellow: '#ff0',
        blue: '#00f', magenta: '#f0f', cyan: '#0ff', white: '#fff',
        brightBlack: '#555', brightRed: '#f55', brightGreen: '#5f5', brightYellow: '#ff5',
        brightBlue: '#55f', brightMagenta: '#f5f', brightCyan: '#5ff', brightWhite: '#fff',
      },
      fontSize: 14, fontFamily: 'Menlo',
    };
    themeStore.addCustomTerminalTheme(termOverride);
    themeStore.setActiveTerminalTheme('dark');

    themeStore.resetBuiltInOverride('dark');
    // Active ID stays the same — built-in resurfaces via lookup
    expect(themeStore.themeState.value.activeTerminalThemeId).toBe('dark');
    expect(themeStore.themeState.value.activeUIThemeId).toBe('dark');
  });
});

// ── Theme property migration ─────────────────────────────────────────────

describe('themeStore migration', () => {
  beforeEach(async () => {
    vi.resetModules();
    localStorageMock.clear();
  });

  it('should fill missing UI theme properties from built-in base on load', async () => {
    // Simulate a saved theme missing newer properties (tabActive, paneBorderActive, sidebarActive)
    const saved = {
      uiMode: 'dark' as const,
      activeUIThemeId: 'dark',
      activeTerminalThemeId: 'dark',
      terminalOverrides: {},
      customUIThemes: [{
        id: 'custom-old',
        name: 'Old Theme',
        bgPrimary: '#111', bgSecondary: '#222', bgTertiary: '#333',
        bgHover: '#444', bgActive: '#555',
        textPrimary: '#eee', textSecondary: '#ccc', textMuted: '#999',
        border: '#444', accent: '#0ff', accentHover: '#0ee',
        destructive: '#f00', destructiveHover: '#e00',
        // Missing: scrollbarThumb, scrollbarThumbHover, tabActive, paneBorderActive, sidebarActive
      }],
      customTerminalThemes: [],
    };
    localStorageMock.setItem('theme-state', JSON.stringify(saved));

    const freshStore = await import('./themeStore.svelte');
    const custom = freshStore.themeState.value.customUIThemes[0];
    // Should have been filled from built-in dark defaults
    expect(custom.scrollbarThumb).toBeDefined();
    expect(custom.tabActive).toBeDefined();
    expect(custom.paneBorderActive).toBeDefined();
    expect(custom.sidebarActive).toBeDefined();
    // Original values preserved
    expect(custom.bgPrimary).toBe('#111');
    expect(custom.name).toBe('Old Theme');
  });

  it('should preserve existing custom values during migration', async () => {
    const saved = {
      uiMode: 'dark' as const,
      activeUIThemeId: 'dark',
      activeTerminalThemeId: 'dark',
      terminalOverrides: {},
      customUIThemes: [{
        id: 'custom-full',
        name: 'Full Theme',
        bgPrimary: '#111', bgSecondary: '#222', bgTertiary: '#333',
        bgHover: '#444', bgActive: '#555',
        textPrimary: '#eee', textSecondary: '#ccc', textMuted: '#999',
        border: '#444', accent: '#0ff', accentHover: '#0ee',
        destructive: '#f00', destructiveHover: '#e00',
        scrollbarThumb: '#custom-scroll', scrollbarThumbHover: '#custom-scroll-hover',
        tabActive: '#custom-tab', paneBorderActive: '#custom-pane', sidebarActive: '#custom-sidebar',
      }],
      customTerminalThemes: [],
    };
    localStorageMock.setItem('theme-state', JSON.stringify(saved));

    const freshStore = await import('./themeStore.svelte');
    const custom = freshStore.themeState.value.customUIThemes[0];
    expect(custom.tabActive).toBe('#custom-tab');
    expect(custom.scrollbarThumb).toBe('#custom-scroll');
  });

  it('should merge nested ansi colors during migration', async () => {
    const saved = {
      uiMode: 'dark' as const,
      activeUIThemeId: 'dark',
      activeTerminalThemeId: 'dark',
      terminalOverrides: {},
      customUIThemes: [],
      customTerminalThemes: [{
        id: 'custom-term',
        name: 'Partial Ansi',
        foreground: '#fff', background: '#000', cursor: '#fff', cursorAccent: '#000',
        selectionBackground: '#333', selectionForeground: '#fff', selectionInactiveBackground: '#222',
        ansi: { black: '#111', red: '#f00' },
        fontSize: 14, fontFamily: 'Menlo',
      }],
    };
    localStorageMock.setItem('theme-state', JSON.stringify(saved));

    const freshStore = await import('./themeStore.svelte');
    const custom = freshStore.themeState.value.customTerminalThemes[0];
    // Custom values preserved
    expect(custom.ansi.black).toBe('#111');
    expect(custom.ansi.red).toBe('#f00');
    // Missing values filled from built-in
    expect(custom.ansi.green).toBeDefined();
    expect(custom.ansi.blue).toBeDefined();
  });

  it('initializeFromServer should run migration on server themes', async () => {
    themeStore = await import('./themeStore.svelte');
    const serverState = {
      uiMode: 'dark' as const,
      activeUIThemeId: 'dark',
      activeTerminalThemeId: 'dark',
      terminalOverrides: {},
      customUIThemes: [{
        id: 'server-theme',
        name: 'Server Theme',
        bgPrimary: '#111', bgSecondary: '#222', bgTertiary: '#333',
        bgHover: '#444', bgActive: '#555',
        textPrimary: '#eee', textSecondary: '#ccc', textMuted: '#999',
        border: '#444', accent: '#0ff', accentHover: '#0ee',
        destructive: '#f00', destructiveHover: '#e00',
        // Missing newer properties
      }] as any[],
      customTerminalThemes: [],
    };
    themeStore.initializeFromServer(serverState as any);
    const custom = themeStore.themeState.value.customUIThemes[0];
    expect(custom.tabActive).toBeDefined();
    expect(custom.paneBorderActive).toBeDefined();
  });
});
