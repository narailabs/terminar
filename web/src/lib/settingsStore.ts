import { writable, derived, get } from 'svelte/store';
import { themeState, getActiveTerminalTheme } from './themeStore';

/**
 * Terminal settings configuration
 */
export interface TerminalSettings {
  fontSize: number;        // 10-24px, default 14
  fontFamily: string;      // Menlo, Monaco, Consolas, Fira Code, JetBrains Mono
  fontColor: string;       // hex color, default #cccccc
  backgroundColor: string; // hex color, default #1e1e1e
  cursorStyle: 'block' | 'underline' | 'bar';
  cursorBlink: boolean;    // default true
  lineHeight: number;      // 1.0-2.0, default 1.0
  showPaneTitleBars: boolean; // default true
}

/**
 * Default terminal settings
 */
export const DEFAULT_SETTINGS: TerminalSettings = {
  fontSize: 14,
  fontFamily: 'Menlo',
  fontColor: '#cccccc',
  backgroundColor: '#1e1e1e',
  cursorStyle: 'block',
  cursorBlink: true,
  lineHeight: 1.0,
  showPaneTitleBars: true,
};

/**
 * ANSI color palettes from VS Code's terminalColorRegistry.ts
 * These ensure TUI apps render correctly on both light and dark backgrounds
 */
const ANSI_COLORS_DARK = {
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
};

const ANSI_COLORS_LIGHT = {
  black: '#000000',
  red: '#cd3131',
  green: '#107C10',
  yellow: '#949800',
  blue: '#0451a5',
  magenta: '#bc05bc',
  cyan: '#0598bc',
  white: '#555555',
  brightBlack: '#666666',
  brightRed: '#cd3131',
  brightGreen: '#14CE14',
  brightYellow: '#b5ba00',
  brightBlue: '#0451a5',
  brightMagenta: '#bc05bc',
  brightCyan: '#0598bc',
  brightWhite: '#a5a5a5',
};

/**
 * Calculate relative luminance of a hex color
 * Used to determine if a background is light or dark
 */
function getLuminance(hexColor: string): number {
  const hex = hexColor.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;

  // Convert to linear RGB
  const toLinear = (c: number) => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const rLin = toLinear(r);
  const gLin = toLinear(g);
  const bLin = toLinear(b);

  // Calculate luminance
  return 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
}

/**
 * Determine if a background color is light or dark
 */
function isLightBackground(backgroundColor: string): boolean {
  return getLuminance(backgroundColor) > 0.5;
}

/**
 * Get appropriate ANSI colors based on background brightness
 */
function getAnsiColors(backgroundColor: string) {
  return isLightBackground(backgroundColor) ? ANSI_COLORS_LIGHT : ANSI_COLORS_DARK;
}

/**
 * Available font family options
 */
export const FONT_FAMILIES = [
  'Menlo',
  'Monaco',
  'Consolas',
  'Fira Code',
  'JetBrains Mono',
] as const;

/**
 * Available cursor style options
 */
export const CURSOR_STYLES = ['block', 'underline', 'bar'] as const;

// LocalStorage key for caching settings
const STORAGE_KEY = 'terminal-settings';

/**
 * Load settings from localStorage cache
 */
function loadFromCache(): TerminalSettings | null {
  try {
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      // Validate and merge with defaults to handle missing fields
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch (e) {
    console.warn('[Settings] Failed to load from cache:', e);
  }
  return null;
}

/**
 * Save settings to localStorage cache
 */
function saveToCache(settings: TerminalSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.warn('[Settings] Failed to save to cache:', e);
  }
}

/**
 * Create the settings store with initial values from cache or defaults
 */
function createSettingsStore() {
  const cachedSettings = loadFromCache();
  const { subscribe, set, update } = writable<TerminalSettings>(
    cachedSettings || DEFAULT_SETTINGS
  );

  // Debounce timer for saving
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let saveCallback: ((settings: TerminalSettings) => Promise<void>) | null = null;

  /**
   * Schedule a debounced save operation
   */
  function scheduleSave(settings: TerminalSettings) {
    // Always save to cache immediately
    saveToCache(settings);

    // Debounce server save
    if (saveTimer) {
      clearTimeout(saveTimer);
    }

    saveTimer = setTimeout(async () => {
      if (saveCallback) {
        try {
          await saveCallback(settings);
        } catch (e) {
          console.error('[Settings] Failed to save to server:', e);
        }
      }
      saveTimer = null;
    }, 500);
  }

  return {
    subscribe,

    /**
     * Set the save callback for persisting settings to the server
     */
    setSaveCallback(callback: (settings: TerminalSettings) => Promise<void>) {
      saveCallback = callback;
    },

    /**
     * Initialize settings from server or use cached/default
     */
    initialize(serverSettings: TerminalSettings | null) {
      if (serverSettings) {
        const merged = { ...DEFAULT_SETTINGS, ...serverSettings };
        set(merged);
        saveToCache(merged);
      }
    },

    /**
     * Update a single setting value
     */
    updateSetting<K extends keyof TerminalSettings>(
      key: K,
      value: TerminalSettings[K]
    ) {
      update((current) => {
        const newSettings = { ...current, [key]: value };
        scheduleSave(newSettings);
        return newSettings;
      });
    },

    /**
     * Update multiple settings at once
     */
    updateSettings(partial: Partial<TerminalSettings>) {
      update((current) => {
        const newSettings = { ...current, ...partial };
        scheduleSave(newSettings);
        return newSettings;
      });
    },

    /**
     * Reset all settings to defaults
     */
    reset() {
      set(DEFAULT_SETTINGS);
      scheduleSave(DEFAULT_SETTINGS);
    },

    /**
     * Get current settings synchronously
     */
    get(): TerminalSettings {
      return get({ subscribe });
    },
  };
}

/**
 * The global terminal settings store
 */
export const settingsStore = createSettingsStore();

/**
 * Derived store that maps settings to xterm options.
 * Layout settings (font, cursor) come from settingsStore.
 * Colors come from themeStore's active terminal theme.
 */
export const xtermOptions = derived(
  [settingsStore, themeState],
  ([$settings, _$themeState]) => {
    const termTheme = getActiveTerminalTheme();

    return {
      fontSize: $settings.fontSize,
      fontFamily: `${$settings.fontFamily}, Monaco, "Courier New", monospace`,
      cursorStyle: $settings.cursorStyle,
      cursorBlink: $settings.cursorBlink,
      lineHeight: $settings.lineHeight,
      theme: {
        foreground: termTheme.foreground,
        background: termTheme.background,
        cursor: termTheme.cursor,
        cursorAccent: termTheme.cursorAccent,
        selectionBackground: termTheme.selectionBackground,
        selectionForeground: termTheme.selectionForeground,
        selectionInactiveBackground: termTheme.selectionInactiveBackground,
        // ANSI colors - critical for TUI apps like Claude Code
        ...termTheme.ansi,
      },
    };
  }
);
