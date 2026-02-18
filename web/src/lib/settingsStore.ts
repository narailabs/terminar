import { writable, derived, get } from 'svelte/store';
import { themeState, getActiveTerminalTheme } from './themeStore';

/**
 * Terminal settings configuration
 */
export interface TerminalSettings {
  fontSize: number;        // 10-24px, default 14
  fontFamily: string;      // Menlo, Monaco, Consolas, Fira Code, JetBrains Mono
  cursorStyle: 'block' | 'underline' | 'bar';
  cursorBlink: boolean;    // default true
  lineHeight: number;      // 1.0-2.0, default 1.0
  showPaneTitleBars: boolean; // default true
  autoScroll: boolean;     // default true — scroll to bottom on new output
}

/**
 * Default terminal settings
 */
export const DEFAULT_SETTINGS: TerminalSettings = {
  fontSize: 14,
  fontFamily: 'Menlo',
  cursorStyle: 'block',
  cursorBlink: true,
  lineHeight: 1.0,
  showPaneTitleBars: true,
  autoScroll: true,
};

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
