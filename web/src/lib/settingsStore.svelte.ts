import { themeState, getActiveTerminalTheme } from './themeStore.svelte';

/**
 * Title bar field configuration — ordered array for display sequence
 */
export type TitleBarFieldId = 'sessionName' | 'terminalTitle' | 'shell' | 'cwd' | 'process' | 'tags';

export interface TitleBarFieldEntry {
  id: TitleBarFieldId;
  visible: boolean;
}

export const TITLE_BAR_FIELD_LABELS: Record<TitleBarFieldId, string> = {
  sessionName: 'Session Name',
  terminalTitle: 'Terminal Title',
  shell: 'Shell',
  cwd: 'Working Directory',
  process: 'Process',
  tags: 'Tags',
};

export const DEFAULT_TITLE_BAR_FIELDS: TitleBarFieldEntry[] = [
  { id: 'sessionName', visible: true },
  { id: 'terminalTitle', visible: true },
  { id: 'shell', visible: true },
  { id: 'cwd', visible: true },
  { id: 'process', visible: true },
  { id: 'tags', visible: true },
];

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
  dimInactivePanes: number; // 0.1-1.0 opacity for inactive panes (1.0 = no dim)
  autoScroll: boolean;     // default true — scroll to bottom on new output
  titleBarFields: TitleBarFieldEntry[];
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
  dimInactivePanes: 0.4,
  autoScroll: true,
  titleBarFields: [...DEFAULT_TITLE_BAR_FIELDS],
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
      const merged = { ...DEFAULT_SETTINGS, ...parsed };
      // Migrate boolean dimInactivePanes → number
      if (typeof merged.dimInactivePanes === 'boolean') {
        merged.dimInactivePanes = merged.dimInactivePanes ? 0.4 : 1.0;
      }
      return merged;
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

let settings = $state<TerminalSettings>(loadFromCache() || DEFAULT_SETTINGS);

// Debounce timer for saving
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saveCallback: ((settings: TerminalSettings) => Promise<void>) | null = null;

/**
 * Schedule a debounced save operation
 */
function scheduleSave(s: TerminalSettings) {
  // Always save to cache immediately
  saveToCache(s);

  // Debounce server save
  if (saveTimer) {
    clearTimeout(saveTimer);
  }

  saveTimer = setTimeout(async () => {
    if (saveCallback) {
      try {
        await saveCallback(s);
      } catch (e) {
        console.error('[Settings] Failed to save to server:', e);
      }
    }
    saveTimer = null;
  }, 500);
}

/**
 * The global terminal settings store
 */
export const settingsStore = {
  get value() {
    return settings;
  },

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
      settings = merged;
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
    const newSettings = { ...settings, [key]: value };
    scheduleSave(newSettings);
    settings = newSettings;
  },

  /**
   * Update multiple settings at once
   */
  updateSettings(partial: Partial<TerminalSettings>) {
    const newSettings = { ...settings, ...partial };
    scheduleSave(newSettings);
    settings = newSettings;
  },

  /**
   * Reset all settings to defaults
   */
  reset() {
    settings = DEFAULT_SETTINGS;
    scheduleSave(DEFAULT_SETTINGS);
  },

  /**
   * Get current settings synchronously
   */
  get(): TerminalSettings {
    return settings;
  },

  /**
   * Subscribe to settings changes (for backward compat with imperative code)
   */
  subscribe(fn: (value: TerminalSettings) => void): () => void {
    // Immediate call with current value
    fn(settings);
    // Use $effect.root to create an effect that watches settings
    const cleanup = $effect.root(() => {
      $effect(() => {
        fn(settings);
      });
    });
    return cleanup;
  },
};

// ── Per-pane title bar visibility overrides ───────────────────────────────────
// Overrides only toggle visibility per-pane; order comes from global settings.

let titleBarOverrides = $state<Record<string, Record<string, boolean>>>({});

export function setTitleBarFieldVisible(paneId: string, fieldId: TitleBarFieldId, visible: boolean): void {
  titleBarOverrides = { ...titleBarOverrides, [paneId]: { ...titleBarOverrides[paneId], [fieldId]: visible } };
}

export function clearTitleBarOverride(paneId: string): void {
  const { [paneId]: _, ...rest } = titleBarOverrides;
  titleBarOverrides = rest;
}

/**
 * Ensure the field list is valid — fills in missing fields from defaults.
 */
function normalizeFields(fields: TitleBarFieldEntry[]): TitleBarFieldEntry[] {
  const seen = new Set(fields.map(f => f.id));
  const missing = DEFAULT_TITLE_BAR_FIELDS.filter(f => !seen.has(f.id));
  return [...fields, ...missing];
}

/**
 * Resolve title bar fields for a pane: global order + per-pane visibility overrides.
 */
export function getTitleBarFields(paneId: string): TitleBarFieldEntry[] {
  const global = normalizeFields(settings.titleBarFields ?? DEFAULT_TITLE_BAR_FIELDS);
  const override = titleBarOverrides[paneId];
  if (!override) return global;
  return global.map(f => (f.id in override) ? { ...f, visible: override[f.id] } : f);
}

export function hasTitleBarOverride(paneId: string): boolean {
  return paneId in titleBarOverrides;
}

/** Access this to establish reactive dependency on overrides */
export const titleBarOverridesState = {
  get value() { return titleBarOverrides; },
};

/**
 * Reactive xterm options derived from settings and theme state.
 * Layout settings (font, cursor) come from settingsStore.
 * Colors come from themeStore's active terminal theme.
 */
export const xtermOptions = {
  get value() {
    // Access both settings and themeState.value to establish reactive dependencies
    const s = settings;
    void themeState.value;
    const termTheme = getActiveTerminalTheme();

    return {
      fontSize: s.fontSize,
      fontFamily: `${s.fontFamily}, Monaco, "Courier New", monospace`,
      cursorStyle: s.cursorStyle,
      cursorBlink: s.cursorBlink,
      lineHeight: s.lineHeight,
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
  },
};
