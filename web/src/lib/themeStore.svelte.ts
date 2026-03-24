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
      return state;
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_STATE };
}

function saveState(state: ThemeState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

let state = $state<ThemeState>(loadState());

function updateState(newState: ThemeState): void {
  state = newState;
  saveState(newState);
}

export const themeState = {
  get value() {
    return state;
  },
};

// ── Theme lookup helpers ─────────────────────────────────────────────────────

function findUITheme(id: string, s: ThemeState): UITheme | undefined {
  return (
    BUILT_IN_UI_THEMES.find((t) => t.id === id) ??
    s.customUIThemes.find((t) => t.id === id)
  );
}

function findTerminalTheme(id: string, s: ThemeState): TerminalTheme | undefined {
  return (
    BUILT_IN_TERMINAL_THEMES.find((t) => t.id === id) ??
    s.customTerminalThemes.find((t) => t.id === id)
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
};

export function applyUIThemeCSS(): void {
  // Resolve mode to pick the right built-in theme
  const resolvedId = state.uiMode === 'auto' ? resolveMode('auto') : state.activeUIThemeId;
  const theme = findUITheme(resolvedId, state) ?? BUILT_IN_UI_THEMES[0];
  const root = document.documentElement;
  for (const [cssVar, themeKey] of Object.entries(UI_CSS_MAP)) {
    root.style.setProperty(cssVar, theme[themeKey]);
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
