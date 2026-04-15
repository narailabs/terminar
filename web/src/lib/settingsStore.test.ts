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
  foreground: '#cacaca',
  background: '#000000',
  cursor: '#fdfbfe',
  cursorAccent: '#000000',
  selectionBackground: '#707070',
  selectionForeground: '#fdfbfe',
  selectionInactiveBackground: '#242629',
  ansi: {
    black: '#000000',
    red: '#cd3131',
    green: '#0DBC79',
    yellow: '#e5e510',
    blue: '#5561ff',
    magenta: '#bc3fbc',
    cyan: '#47c4ff',
    white: '#e5e5e5',
    brightBlack: '#666666',
    brightRed: '#f14c4c',
    brightGreen: '#23d18b',
    brightYellow: '#f5f543',
    brightBlue: '#a0a7ff',
    brightMagenta: '#d670d6',
    brightCyan: '#47c4ff',
    brightWhite: '#e5e5e5',
  },
  fontSize: 14,
  fontFamily: 'Menlo',
};

const { mockThemeStateWritable } = vi.hoisted(() => {
  const { writable } = require('svelte/store');
  return {
    mockThemeStateWritable: writable({
      uiMode: 'dark',
      activeUIThemeId: 'dark',
      activeTerminalThemeId: 'dark',
      terminalOverrides: {},
      customUIThemes: [],
      customTerminalThemes: [],
    }),
  };
});

vi.mock('./themeStore.svelte', () => ({
  themeState: mockThemeStateWritable,
  getActiveTerminalTheme: vi.fn(() => mockTerminalTheme),
}));

// ── Import under test (after mocks are in place) ────────────────────────────

import {
  settingsStore,
  xtermOptions,
  DEFAULT_SETTINGS,
  FONT_FAMILIES,
  CURSOR_STYLES,
  type TerminalSettings,
} from './settingsStore.svelte';

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
    const current = settingsStore.value;
    expect(current).toEqual(DEFAULT_SETTINGS);
  });

  // ── 2. loadFromCache behavior (indirect) ────────────────────────────────

  it('should use cached values after initialize is called with server settings', () => {
    // We cannot test the module-level loadFromCache directly since the singleton
    // was already created. Instead, verify that initialize() + saveToCache round-trips.
    const customSettings: TerminalSettings = {
      ...DEFAULT_SETTINGS,
      terminalZoom: 1.5,
      controlsZoom: 0.8,
    };
    settingsStore.initialize(customSettings);

    // Verify localStorage was written
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'terminal-settings',
      expect.any(String)
    );
    const stored = JSON.parse(localStorageMock._getStore()['terminal-settings']);
    expect(stored.terminalZoom).toBe(1.5);
    expect(stored.controlsZoom).toBe(0.8);
  });

  // ── 3. initialize() with server settings merges with defaults ───────────

  it('initialize() should merge server settings with defaults', () => {
    const partial = { terminalZoom: 1.5, cursorBlink: false } as TerminalSettings;
    settingsStore.initialize(partial);

    const current = settingsStore.value;
    expect(current.terminalZoom).toBe(1.5);
    expect(current.cursorBlink).toBe(false);
    // Other fields should remain as defaults
    expect(current.controlsZoom).toBe(DEFAULT_SETTINGS.controlsZoom);
    expect(current.lineHeight).toBe(DEFAULT_SETTINGS.lineHeight);
    expect(current.showPaneTitleBars).toBe(DEFAULT_SETTINGS.showPaneTitleBars);
  });

  // ── 4. initialize(null) does nothing ────────────────────────────────────

  it('initialize(null) should not change the store', () => {
    const before = settingsStore.value;
    settingsStore.initialize(null);
    const after = settingsStore.value;
    expect(after).toEqual(before);
  });

  // ── 5. updateSetting() updates a single key ────────────────────────────

  it('updateSetting() should update a single key', () => {
    settingsStore.updateSetting('terminalZoom', 1.5);
    const current = settingsStore.value;
    expect(current.terminalZoom).toBe(1.5);
    // Other keys remain unchanged
    expect(current.controlsZoom).toBe(DEFAULT_SETTINGS.controlsZoom);
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

  // ── 6b. defaultCwd round-trips through the store ───────────────────────

  it('should default defaultCwd to empty string', () => {
    expect(settingsStore.value.defaultCwd).toBe('');
  });

  it('updateSetting() should accept a defaultCwd path', () => {
    settingsStore.updateSetting('defaultCwd', '/Users/me/code');
    expect(settingsStore.get().defaultCwd).toBe('/Users/me/code');

    const stored = JSON.parse(localStorageMock._getStore()['terminal-settings']);
    expect(stored.defaultCwd).toBe('/Users/me/code');
  });

  // ── 7. updateSettings() updates multiple keys ──────────────────────────

  it('updateSettings() should update multiple keys at once', () => {
    settingsStore.updateSettings({
      terminalZoom: 1.5,
      controlsZoom: 0.8,
      cursorBlink: false,
    });

    const current = settingsStore.value;
    expect(current.terminalZoom).toBe(1.5);
    expect(current.controlsZoom).toBe(0.8);
    expect(current.cursorBlink).toBe(false);
    // Untouched keys remain default
    expect(current.lineHeight).toBe(DEFAULT_SETTINGS.lineHeight);
  });

  // ── 8. reset() returns to DEFAULT_SETTINGS ─────────────────────────────

  it('reset() should return all settings to defaults', () => {
    settingsStore.updateSettings({ terminalZoom: 2.0, controlsZoom: 0.5 });
    settingsStore.reset();

    const current = settingsStore.value;
    expect(current).toEqual(DEFAULT_SETTINGS);
  });

  // ── 9. reset() saves defaults to localStorage ──────────────────────────

  it('reset() should save DEFAULT_SETTINGS to localStorage', () => {
    settingsStore.updateSettings({ terminalZoom: 2.0 });
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

    settingsStore.updateSetting('terminalZoom', 1.5);

    // Not called immediately
    expect(saveCallback).not.toHaveBeenCalled();

    // Advance past the 500ms debounce
    vi.advanceTimersByTime(500);

    // Allow the async callback to resolve
    await vi.runAllTimersAsync();

    expect(saveCallback).toHaveBeenCalledTimes(1);
    expect(saveCallback).toHaveBeenCalledWith(
      expect.objectContaining({ terminalZoom: 1.5 })
    );

    // Clean up
    settingsStore.setSaveCallback(null as any);
  });

  // ── 11. scheduleSave debounces: multiple rapid updates only trigger one save

  it('should debounce multiple rapid updates into a single save callback', async () => {
    const saveCallback = vi.fn().mockResolvedValue(undefined);
    settingsStore.setSaveCallback(saveCallback);

    settingsStore.updateSetting('terminalZoom', 1.2);
    vi.advanceTimersByTime(100);
    settingsStore.updateSetting('terminalZoom', 1.5);
    vi.advanceTimersByTime(100);
    settingsStore.updateSetting('terminalZoom', 2.0);

    // Not yet called (timer keeps resetting)
    expect(saveCallback).not.toHaveBeenCalled();

    // Advance past debounce from the last call
    vi.advanceTimersByTime(500);
    await vi.runAllTimersAsync();

    expect(saveCallback).toHaveBeenCalledTimes(1);
    // Should be called with the final value
    expect(saveCallback).toHaveBeenCalledWith(
      expect.objectContaining({ terminalZoom: 2.0 })
    );

    // Clean up
    settingsStore.setSaveCallback(null as any);
  });

  // ── 12. get() returns current settings synchronously ────────────────────

  it('get() should return current settings synchronously', () => {
    settingsStore.updateSetting('terminalZoom', 1.2);
    const result = settingsStore.get();
    expect(result.terminalZoom).toBe(1.2);
    expect(result).toEqual(settingsStore.value);
  });

  // ── 13. xtermOptions derived store maps settings correctly ──────────────

  it('xtermOptions should derive correct xterm options from settings and theme', () => {
    // Font comes from the theme (mockTerminalTheme.fontSize=14, fontFamily='Menlo')
    // Zoom defaults to 1.0, so effective fontSize = 14 * 1.0 / 1.0 = 14
    settingsStore.updateSettings({
      cursorStyle: 'bar',
      cursorBlink: false,
      lineHeight: 1.2,
    });

    const opts = xtermOptions.value;

    expect(opts.fontSize).toBe(14); // theme's base font size at zoom 1.0
    expect(opts.fontFamily).toBe('Menlo, Monaco, "Courier New", monospace');
    expect(opts.cursorStyle).toBe('bar');
    expect(opts.cursorBlink).toBe(false);
    expect(opts.lineHeight).toBe(1.2);

    // Theme colors come from the mocked getActiveTerminalTheme
    expect(opts.theme.foreground).toBe('#cacaca');
    expect(opts.theme.background).toBe('#000000');
    expect(opts.theme.cursor).toBe('#fdfbfe');
    expect(opts.theme.cursorAccent).toBe('#000000');
    expect(opts.theme.selectionBackground).toBe('#707070');
    expect(opts.theme.selectionForeground).toBe('#fdfbfe');
    expect(opts.theme.selectionInactiveBackground).toBe('#242629');

    // ANSI colors should be spread into the theme object
    expect(opts.theme.black).toBe('#000000');
    expect(opts.theme.red).toBe('#cd3131');
    expect(opts.theme.green).toBe('#0DBC79');
  });

  it('xtermOptions should apply terminal zoom to theme font size', () => {
    settingsStore.updateSettings({
      terminalZoom: 1.5,
    });

    const opts = xtermOptions.value;
    // effectiveFontSize = Math.round(14 * 1.5) = 21
    expect(opts.fontSize).toBe(21);
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
