import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock localStorage before any imports ────────────────────────────────────

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    _getStore: () => store,
  };
})();
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

// ── Mock themeStore ─────────────────────────────────────────────────────────

const mockTerminalTheme = {
  id: 'dark',
  name: 'Dark',
  foreground: '#cccccc',
  background: '#1e1e1e',
  cursor: '#cccccc',
  cursorAccent: '#1e1e1e',
  selectionBackground: '#264f78',
  selectionForeground: '#ffffff',
  selectionInactiveBackground: '#3a3d41',
  ansi: {
    black: '#000000',
    red: '#cd3131',
    green: '#0DBC79',
    yellow: '#e5e510',
    blue: '#2472c8',
    magenta: '#bc3fbc',
    cyan: '#11a8cd',
    white: '#e5e5e5',
    brightBlack: '#666666',
    brightRed: '#f14c4c',
    brightGreen: '#23d18b',
    brightYellow: '#f5f543',
    brightBlue: '#3b8eea',
    brightMagenta: '#d670d6',
    brightCyan: '#29b8db',
    brightWhite: '#e5e5e5',
  },
};

vi.mock('./themeStore', () => {
  const { writable } = require('svelte/store');
  return {
    themeState: writable({
      uiMode: 'dark',
      activeUIThemeId: 'dark',
      activeTerminalThemeId: 'dark',
      terminalOverrides: {},
      customUIThemes: [],
      customTerminalThemes: [],
    }),
    getActiveTerminalTheme: vi.fn(() => mockTerminalTheme),
  };
});

// ── Import under test (after mocks are in place) ────────────────────────────

import {
  settingsStore,
  xtermOptions,
  DEFAULT_SETTINGS,
  FONT_FAMILIES,
  CURSOR_STYLES,
  type TerminalSettings,
} from './settingsStore';
import { get } from 'svelte/store';

// ── Tests ───────────────────────────────────────────────────────────────────

describe('settingsStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorageMock.clear();
    vi.clearAllMocks();
    // Reset the store to defaults between tests
    settingsStore.reset();
    // Flush the debounced save from reset()
    vi.advanceTimersByTime(500);
    // Clear mocks again so tests start clean
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── 1. Initial value matches DEFAULT_SETTINGS when no cache ─────────────

  it('should have DEFAULT_SETTINGS as initial value when no cache exists', () => {
    const current = get(settingsStore);
    expect(current).toEqual(DEFAULT_SETTINGS);
  });

  // ── 2. loadFromCache behavior (indirect) ────────────────────────────────

  it('should use cached values after initialize is called with server settings', () => {
    // We cannot test the module-level loadFromCache directly since the singleton
    // was already created. Instead, verify that initialize() + saveToCache round-trips.
    const customSettings: TerminalSettings = {
      ...DEFAULT_SETTINGS,
      fontSize: 18,
      fontFamily: 'Monaco',
    };
    settingsStore.initialize(customSettings);

    // Verify localStorage was written
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'terminal-settings',
      expect.any(String)
    );
    const stored = JSON.parse(localStorageMock._getStore()['terminal-settings']);
    expect(stored.fontSize).toBe(18);
    expect(stored.fontFamily).toBe('Monaco');
  });

  // ── 3. initialize() with server settings merges with defaults ───────────

  it('initialize() should merge server settings with defaults', () => {
    const partial = { fontSize: 20, cursorBlink: false } as TerminalSettings;
    settingsStore.initialize(partial);

    const current = get(settingsStore);
    expect(current.fontSize).toBe(20);
    expect(current.cursorBlink).toBe(false);
    // Other fields should remain as defaults
    expect(current.fontFamily).toBe(DEFAULT_SETTINGS.fontFamily);
    expect(current.lineHeight).toBe(DEFAULT_SETTINGS.lineHeight);
    expect(current.showPaneTitleBars).toBe(DEFAULT_SETTINGS.showPaneTitleBars);
  });

  // ── 4. initialize(null) does nothing ────────────────────────────────────

  it('initialize(null) should not change the store', () => {
    const before = get(settingsStore);
    settingsStore.initialize(null);
    const after = get(settingsStore);
    expect(after).toEqual(before);
  });

  // ── 5. updateSetting() updates a single key ────────────────────────────

  it('updateSetting() should update a single key', () => {
    settingsStore.updateSetting('fontSize', 22);
    const current = get(settingsStore);
    expect(current.fontSize).toBe(22);
    // Other keys remain unchanged
    expect(current.fontFamily).toBe(DEFAULT_SETTINGS.fontFamily);
  });

  // ── 6. updateSetting() saves to localStorage ───────────────────────────

  it('updateSetting() should save to localStorage immediately', () => {
    settingsStore.updateSetting('cursorStyle', 'underline');

    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'terminal-settings',
      expect.any(String)
    );
    const stored = JSON.parse(localStorageMock._getStore()['terminal-settings']);
    expect(stored.cursorStyle).toBe('underline');
  });

  // ── 7. updateSettings() updates multiple keys ──────────────────────────

  it('updateSettings() should update multiple keys at once', () => {
    settingsStore.updateSettings({
      fontSize: 16,
      fontFamily: 'Fira Code',
      cursorBlink: false,
    });

    const current = get(settingsStore);
    expect(current.fontSize).toBe(16);
    expect(current.fontFamily).toBe('Fira Code');
    expect(current.cursorBlink).toBe(false);
    // Untouched keys remain default
    expect(current.lineHeight).toBe(DEFAULT_SETTINGS.lineHeight);
  });

  // ── 8. reset() returns to DEFAULT_SETTINGS ─────────────────────────────

  it('reset() should return all settings to defaults', () => {
    settingsStore.updateSettings({ fontSize: 24, fontFamily: 'Consolas' });
    settingsStore.reset();

    const current = get(settingsStore);
    expect(current).toEqual(DEFAULT_SETTINGS);
  });

  // ── 9. reset() saves defaults to localStorage ──────────────────────────

  it('reset() should save DEFAULT_SETTINGS to localStorage', () => {
    settingsStore.updateSettings({ fontSize: 24 });
    vi.clearAllMocks();

    settingsStore.reset();

    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'terminal-settings',
      JSON.stringify(DEFAULT_SETTINGS)
    );
  });

  // ── 10. setSaveCallback + scheduleSave: debounced save fires after 500ms

  it('should call saveCallback after 500ms debounce when setting changes', async () => {
    const saveCallback = vi.fn().mockResolvedValue(undefined);
    settingsStore.setSaveCallback(saveCallback);

    settingsStore.updateSetting('fontSize', 18);

    // Not called immediately
    expect(saveCallback).not.toHaveBeenCalled();

    // Advance past the 500ms debounce
    vi.advanceTimersByTime(500);

    // Allow the async callback to resolve
    await vi.runAllTimersAsync();

    expect(saveCallback).toHaveBeenCalledTimes(1);
    expect(saveCallback).toHaveBeenCalledWith(
      expect.objectContaining({ fontSize: 18 })
    );

    // Clean up
    settingsStore.setSaveCallback(null as any);
  });

  // ── 11. scheduleSave debounces: multiple rapid updates only trigger one save

  it('should debounce multiple rapid updates into a single save callback', async () => {
    const saveCallback = vi.fn().mockResolvedValue(undefined);
    settingsStore.setSaveCallback(saveCallback);

    settingsStore.updateSetting('fontSize', 16);
    vi.advanceTimersByTime(100);
    settingsStore.updateSetting('fontSize', 18);
    vi.advanceTimersByTime(100);
    settingsStore.updateSetting('fontSize', 20);

    // Not yet called (timer keeps resetting)
    expect(saveCallback).not.toHaveBeenCalled();

    // Advance past debounce from the last call
    vi.advanceTimersByTime(500);
    await vi.runAllTimersAsync();

    expect(saveCallback).toHaveBeenCalledTimes(1);
    // Should be called with the final value
    expect(saveCallback).toHaveBeenCalledWith(
      expect.objectContaining({ fontSize: 20 })
    );

    // Clean up
    settingsStore.setSaveCallback(null as any);
  });

  // ── 12. get() returns current settings synchronously ────────────────────

  it('get() should return current settings synchronously', () => {
    settingsStore.updateSetting('fontSize', 12);
    const result = settingsStore.get();
    expect(result.fontSize).toBe(12);
    expect(result).toEqual(get(settingsStore));
  });

  // ── 13. xtermOptions derived store maps settings correctly ──────────────

  it('xtermOptions should derive correct xterm options from settings and theme', () => {
    settingsStore.updateSettings({
      fontSize: 16,
      fontFamily: 'Fira Code',
      cursorStyle: 'bar',
      cursorBlink: false,
      lineHeight: 1.2,
    });

    const opts = get(xtermOptions);

    expect(opts.fontSize).toBe(16);
    expect(opts.fontFamily).toBe('Fira Code, Monaco, "Courier New", monospace');
    expect(opts.cursorStyle).toBe('bar');
    expect(opts.cursorBlink).toBe(false);
    expect(opts.lineHeight).toBe(1.2);

    // Theme colors come from the mocked getActiveTerminalTheme
    expect(opts.theme.foreground).toBe('#cccccc');
    expect(opts.theme.background).toBe('#1e1e1e');
    expect(opts.theme.cursor).toBe('#cccccc');
    expect(opts.theme.cursorAccent).toBe('#1e1e1e');
    expect(opts.theme.selectionBackground).toBe('#264f78');
    expect(opts.theme.selectionForeground).toBe('#ffffff');
    expect(opts.theme.selectionInactiveBackground).toBe('#3a3d41');

    // ANSI colors should be spread into the theme object
    expect(opts.theme.black).toBe('#000000');
    expect(opts.theme.red).toBe('#cd3131');
    expect(opts.theme.green).toBe('#0DBC79');
  });

  // ── 14. FONT_FAMILIES export ────────────────────────────────────────────

  it('FONT_FAMILIES should contain the expected font families', () => {
    expect(FONT_FAMILIES).toEqual([
      'Menlo',
      'Monaco',
      'Consolas',
      'Fira Code',
      'JetBrains Mono',
    ]);
  });

  // ── 15. CURSOR_STYLES export ────────────────────────────────────────────

  it('CURSOR_STYLES should contain the expected cursor styles', () => {
    expect(CURSOR_STYLES).toEqual(['block', 'underline', 'bar']);
  });
});
