/**
 * Theme state management with CSS custom property application.
 *
 * Two-layer system:
 * - UI themes set CSS variables on document.documentElement for all chrome
 * - Terminal themes are resolved per-pane via getTerminalTheme(paneId)
 */

import {
  BUILT_IN_UI_THEMES,
  BUILT_IN_TERMINAL_THEMES,
  BUILT_IN_UI_THEME_IDS,
  BUILT_IN_TERMINAL_THEME_IDS,
  type UITheme,
  type TerminalTheme,
} from './themeTypes';

// ── State ────────────────────────────────────────────────────────────────────

export type UIMode = 'light' | 'dark' | 'auto';

export interface ThemeState {
  uiMode: UIMode;
  activeUIThemeId: string;
  activeTerminalThemeId: string;
  terminalOverrides: Record<string, string>; // paneId -> terminalThemeId
  customUIThemes: UITheme[];
  customTerminalThemes: TerminalTheme[];
}

const STORAGE_KEY = 'theme-state';

const DEFAULT_STATE: ThemeState = {
  uiMode: 'dark',
  activeUIThemeId: 'dark',
  activeTerminalThemeId: 'dark',
  terminalOverrides: {},
  customUIThemes: [],
  customTerminalThemes: [],
};

function loadState(): ThemeState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const state = { ...DEFAULT_STATE, ...parsed };
      // Migrate: if no uiMode saved, derive from activeUIThemeId
      if (!parsed.uiMode) {
        state.uiMode = state.activeUIThemeId === 'light' ? 'light' : 'dark';
      }
      // Migrate: if activeUIThemeId was dark-green, fall back to dark
      if (state.activeUIThemeId === 'dark-green') {
        state.activeUIThemeId = 'dark';
        state.uiMode = 'dark';
      }
      return migrateCustomThemes(state);
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_STATE };
}

function migrateCustomThemes(s: ThemeState): ThemeState {
  const migratedUI = s.customUIThemes.map((custom) => {
    const base = BUILT_IN_UI_THEMES.find((b) => b.id === custom.id) ?? BUILT_IN_UI_THEMES[0];
    return { ...base, ...custom };
  });
  const migratedTerminal = s.customTerminalThemes.map((custom) => {
    const base =
      BUILT_IN_TERMINAL_THEMES.find((b) => b.id === custom.id) ?? BUILT_IN_TERMINAL_THEMES[0];
    return { ...base, ...custom, ansi: { ...base.ansi, ...(custom.ansi ?? {}) } };
  });
  return { ...s, customUIThemes: migratedUI, customTerminalThemes: migratedTerminal };
}

function saveState(state: ThemeState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

let state = $state<ThemeState>(loadState());
let serverSaveCallback: ((themes: ThemeState) => Promise<void>) | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSave(s: ThemeState): void {
  // Always save to localStorage immediately (cache)
  saveState(s);

  // Debounce server save
  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  saveTimer = setTimeout(async () => {
    if (serverSaveCallback) {
      try {
        await serverSaveCallback(s);
      } catch (e) {
        console.error('[ThemeStore] Failed to save to server:', e);
      }
    }
    saveTimer = null;
  }, 500);
}

function updateState(newState: ThemeState): void {
  state = newState;
  scheduleSave(newState);
}

export const themeState = {
  get value() {
    return state;
  },
};

// ── Theme lookup helpers ─────────────────────────────────────────────────────

function findUITheme(id: string, s: ThemeState): UITheme | undefined {
  return (
    s.customUIThemes.find((t) => t.id === id) ??
    BUILT_IN_UI_THEMES.find((t) => t.id === id)
  );
}

function findTerminalTheme(id: string, s: ThemeState): TerminalTheme | undefined {
  return (
    s.customTerminalThemes.find((t) => t.id === id) ??
    BUILT_IN_TERMINAL_THEMES.find((t) => t.id === id)
  );
}

// ── Public API ───────────────────────────────────────────────────────────────

export function setUIMode(mode: UIMode): void {
  const resolved = resolveMode(mode);
  updateState({ ...state, uiMode: mode, activeUIThemeId: resolved });
}

export function getResolvedUIMode(): 'light' | 'dark' {
  return resolveMode(state.uiMode);
}

function resolveMode(mode: UIMode): 'light' | 'dark' {
  if (mode === 'auto') {
    return typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }
  return mode;
}

let autoModeCleanup: (() => void) | null = null;

export function initAutoMode(): void {
  // Clean up any previous listener
  if (autoModeCleanup) {
    autoModeCleanup();
    autoModeCleanup = null;
  }

  if (typeof window === 'undefined') return;

  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = () => {
    if (state.uiMode === 'auto') {
      const resolved = resolveMode('auto');
      updateState({ ...state, activeUIThemeId: resolved });
    }
  };
  mql.addEventListener('change', handler);
  autoModeCleanup = () => mql.removeEventListener('change', handler);
}

export function setActiveUITheme(id: string): void {
  updateState({ ...state, activeUIThemeId: id });
}

export function setActiveTerminalTheme(id: string): void {
  updateState({ ...state, activeTerminalThemeId: id });
}

export function setTerminalOverride(paneId: string, themeId: string): void {
  updateState({
    ...state,
    terminalOverrides: { ...state.terminalOverrides, [paneId]: themeId },
  });
}

export function clearTerminalOverride(paneId: string): void {
  const { [paneId]: _, ...rest } = state.terminalOverrides;
  updateState({ ...state, terminalOverrides: rest });
}

export function getTerminalTheme(paneId: string): TerminalTheme {
  const overrideId = state.terminalOverrides[paneId];
  if (overrideId) {
    const override = findTerminalTheme(overrideId, state);
    if (override) return override;
  }
  return findTerminalTheme(state.activeTerminalThemeId, state) ?? BUILT_IN_TERMINAL_THEMES[0];
}

export function getActiveUITheme(): UITheme {
  return findUITheme(state.activeUIThemeId, state) ?? BUILT_IN_UI_THEMES[0];
}

export function getActiveTerminalTheme(): TerminalTheme {
  return findTerminalTheme(state.activeTerminalThemeId, state) ?? BUILT_IN_TERMINAL_THEMES[0];
}

// ── CSS variable application ─────────────────────────────────────────────────

const UI_CSS_MAP: Record<string, keyof UITheme> = {
  '--ui-bg-primary': 'bgPrimary',
  '--ui-bg-secondary': 'bgSecondary',
  '--ui-bg-tertiary': 'bgTertiary',
  '--ui-bg-hover': 'bgHover',
  '--ui-bg-active': 'bgActive',
  '--ui-text-primary': 'textPrimary',
  '--ui-text-secondary': 'textSecondary',
  '--ui-text-muted': 'textMuted',
  '--ui-border': 'border',
  '--ui-accent': 'accent',
  '--ui-accent-hover': 'accentHover',
  '--ui-destructive': 'destructive',
  '--ui-destructive-hover': 'destructiveHover',
  '--ui-scrollbar-thumb': 'scrollbarThumb',
  '--ui-scrollbar-thumb-hover': 'scrollbarThumbHover',
  '--ui-tab-active': 'tabActive',
  '--ui-pane-border-active': 'paneBorderActive',
  '--ui-sidebar-active': 'sidebarActive',
};

export function applyUIThemeCSS(): void {
  // Resolve mode to pick the right built-in theme
  const resolvedId = state.uiMode === 'auto' ? resolveMode('auto') : state.activeUIThemeId;
  const theme = findUITheme(resolvedId, state) ?? BUILT_IN_UI_THEMES[0];
  const root = document.documentElement;
  for (const [cssVar, themeKey] of Object.entries(UI_CSS_MAP)) {
    root.style.setProperty(cssVar, theme[themeKey]);
  }

  // Apply per-terminal-theme UI overrides (saved with the terminal theme's ID
  // when editing built-in themes, where terminal/UI theme IDs may differ)
  const termUIOverride = state.customUIThemes.find((t) => t.id === state.activeTerminalThemeId);
  if (termUIOverride) {
    root.style.setProperty('--ui-accent', termUIOverride.accent);
    root.style.setProperty('--ui-accent-hover', termUIOverride.accentHover);
    root.style.setProperty('--ui-tab-active', termUIOverride.tabActive);
    root.style.setProperty('--ui-pane-border-active', termUIOverride.paneBorderActive);
    root.style.setProperty('--ui-sidebar-active', termUIOverride.sidebarActive);
  }
}

// ── Custom theme management ──────────────────────────────────────────────────

export function addCustomUITheme(theme: UITheme): void {
  updateState({
    ...state,
    customUIThemes: [...state.customUIThemes, theme],
  });
}

export function addCustomTerminalTheme(theme: TerminalTheme): void {
  updateState({
    ...state,
    customTerminalThemes: [...state.customTerminalThemes, theme],
  });
}

export function updateCustomUITheme(id: string, theme: UITheme): void {
  updateState({
    ...state,
    customUIThemes: state.customUIThemes.map((t) => (t.id === id ? theme : t)),
  });
}

export function updateCustomTerminalTheme(id: string, theme: TerminalTheme): void {
  updateState({
    ...state,
    customTerminalThemes: state.customTerminalThemes.map((t) => (t.id === id ? theme : t)),
  });
}

export function upsertCustomUITheme(theme: UITheme): void {
  const exists = state.customUIThemes.some((t) => t.id === theme.id);
  if (exists) {
    updateCustomUITheme(theme.id, theme);
  } else {
    addCustomUITheme(theme);
  }
}

export function upsertCustomTerminalTheme(theme: TerminalTheme): void {
  const exists = state.customTerminalThemes.some((t) => t.id === theme.id);
  if (exists) {
    updateCustomTerminalTheme(theme.id, theme);
  } else {
    addCustomTerminalTheme(theme);
  }
}

export function isBuiltInOverridden(id: string): boolean {
  return (
    (BUILT_IN_UI_THEME_IDS.has(id) && state.customUIThemes.some((t) => t.id === id)) ||
    (BUILT_IN_TERMINAL_THEME_IDS.has(id) && state.customTerminalThemes.some((t) => t.id === id))
  );
}

export function resetBuiltInOverride(id: string): void {
  updateState({
    ...state,
    customUIThemes: state.customUIThemes.filter((t) => t.id !== id),
    customTerminalThemes: state.customTerminalThemes.filter((t) => t.id !== id),
  });
}

export function deleteCustomUITheme(id: string): void {
  const newState = {
    ...state,
    customUIThemes: state.customUIThemes.filter((t) => t.id !== id),
  };
  // Fall back to dark if the deleted theme was active
  if (state.activeUIThemeId === id) {
    newState.activeUIThemeId = 'dark';
  }
  updateState(newState);
}

export function deleteCustomTerminalTheme(id: string): void {
  // Clear any pane overrides using the deleted theme
  const newOverrides = { ...state.terminalOverrides };
  for (const [paneId, themeId] of Object.entries(newOverrides)) {
    if (themeId === id) {
      delete newOverrides[paneId];
    }
  }
  const newState = {
    ...state,
    customTerminalThemes: state.customTerminalThemes.filter((t) => t.id !== id),
    terminalOverrides: newOverrides,
  };
  // Fall back to dark if the deleted theme was active
  if (state.activeTerminalThemeId === id) {
    newState.activeTerminalThemeId = 'dark';
  }
  updateState(newState);
}

// ── Server sync API ─────────────────────────────────────────────────────────

export function setSaveCallback(callback: (themes: ThemeState) => Promise<void>): void {
  serverSaveCallback = callback;
}

export function initializeFromServer(serverThemes: ThemeState | null): void {
  if (serverThemes) {
    const merged = migrateCustomThemes({ ...DEFAULT_STATE, ...serverThemes });
    state = merged;
    saveState(merged);
  }
}

export const themeStoreApi = {
  initialize: initializeFromServer,
  setSaveCallback,
};
