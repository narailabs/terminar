/**
 * Theme state management with CSS custom property application.
 *
 * Two-layer system:
 * - UI themes set CSS variables on document.documentElement for all chrome
 * - Terminal themes are resolved per-pane via getTerminalTheme(paneId)
 */

import { writable, get } from 'svelte/store';
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

export const themeState = writable<ThemeState>(loadState());

// Auto-save on every change
themeState.subscribe((state) => {
  saveState(state);
});

// ── Theme lookup helpers ─────────────────────────────────────────────────────

function findUITheme(id: string, state: ThemeState): UITheme | undefined {
  return (
    BUILT_IN_UI_THEMES.find((t) => t.id === id) ??
    state.customUIThemes.find((t) => t.id === id)
  );
}

function findTerminalTheme(id: string, state: ThemeState): TerminalTheme | undefined {
  return (
    BUILT_IN_TERMINAL_THEMES.find((t) => t.id === id) ??
    state.customTerminalThemes.find((t) => t.id === id)
  );
}

// ── Public API ───────────────────────────────────────────────────────────────

export function setUIMode(mode: UIMode): void {
  const resolved = resolveMode(mode);
  themeState.update((s) => ({ ...s, uiMode: mode, activeUIThemeId: resolved }));
}

export function getResolvedUIMode(): 'light' | 'dark' {
  const state = get(themeState);
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
    const state = get(themeState);
    if (state.uiMode === 'auto') {
      const resolved = resolveMode('auto');
      themeState.update((s) => ({ ...s, activeUIThemeId: resolved }));
    }
  };
  mql.addEventListener('change', handler);
  autoModeCleanup = () => mql.removeEventListener('change', handler);
}

export function setActiveUITheme(id: string): void {
  themeState.update((s) => ({ ...s, activeUIThemeId: id }));
}

export function setActiveTerminalTheme(id: string): void {
  themeState.update((s) => ({ ...s, activeTerminalThemeId: id }));
}

export function setTerminalOverride(paneId: string, themeId: string): void {
  themeState.update((s) => ({
    ...s,
    terminalOverrides: { ...s.terminalOverrides, [paneId]: themeId },
  }));
}

export function clearTerminalOverride(paneId: string): void {
  themeState.update((s) => {
    const { [paneId]: _, ...rest } = s.terminalOverrides;
    return { ...s, terminalOverrides: rest };
  });
}

export function getTerminalTheme(paneId: string): TerminalTheme {
  const state = get(themeState);
  const overrideId = state.terminalOverrides[paneId];
  if (overrideId) {
    const override = findTerminalTheme(overrideId, state);
    if (override) return override;
  }
  return findTerminalTheme(state.activeTerminalThemeId, state) ?? BUILT_IN_TERMINAL_THEMES[0];
}

export function getActiveUITheme(): UITheme {
  const state = get(themeState);
  return findUITheme(state.activeUIThemeId, state) ?? BUILT_IN_UI_THEMES[0];
}

export function getActiveTerminalTheme(): TerminalTheme {
  const state = get(themeState);
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
  const state = get(themeState);
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
  themeState.update((s) => ({
    ...s,
    customUIThemes: [...s.customUIThemes, theme],
  }));
}

export function addCustomTerminalTheme(theme: TerminalTheme): void {
  themeState.update((s) => ({
    ...s,
    customTerminalThemes: [...s.customTerminalThemes, theme],
  }));
}

export function updateCustomUITheme(id: string, theme: UITheme): void {
  themeState.update((s) => ({
    ...s,
    customUIThemes: s.customUIThemes.map((t) => (t.id === id ? theme : t)),
  }));
}

export function updateCustomTerminalTheme(id: string, theme: TerminalTheme): void {
  themeState.update((s) => ({
    ...s,
    customTerminalThemes: s.customTerminalThemes.map((t) => (t.id === id ? theme : t)),
  }));
}

export function deleteCustomUITheme(id: string): void {
  themeState.update((s) => {
    const newState = {
      ...s,
      customUIThemes: s.customUIThemes.filter((t) => t.id !== id),
    };
    // Fall back to dark if the deleted theme was active
    if (s.activeUIThemeId === id) {
      newState.activeUIThemeId = 'dark';
    }
    return newState;
  });
}

export function deleteCustomTerminalTheme(id: string): void {
  themeState.update((s) => {
    // Clear any pane overrides using the deleted theme
    const newOverrides = { ...s.terminalOverrides };
    for (const [paneId, themeId] of Object.entries(newOverrides)) {
      if (themeId === id) {
        delete newOverrides[paneId];
      }
    }
    const newState = {
      ...s,
      customTerminalThemes: s.customTerminalThemes.filter((t) => t.id !== id),
      terminalOverrides: newOverrides,
    };
    // Fall back to dark if the deleted theme was active
    if (s.activeTerminalThemeId === id) {
      newState.activeTerminalThemeId = 'dark';
    }
    return newState;
  });
}
