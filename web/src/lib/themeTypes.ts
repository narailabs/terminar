/**
 * Theme type definitions and built-in theme data for the two-layer theme system.
 *
 * UITheme: Controls all non-terminal UI chrome (tabs, sidebars, context menus, etc.)
 * TerminalTheme: Controls xterm.js rendering (foreground, background, ANSI palette)
 */

// ── UI Theme ─────────────────────────────────────────────────────────────────

export interface UITheme {
  id: string;
  name: string;
  bgPrimary: string;
  bgSecondary: string;
  bgTertiary: string;
  bgHover: string;
  bgActive: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  accent: string;
  accentHover: string;
  destructive: string;
  destructiveHover: string;
  scrollbarThumb: string;
  scrollbarThumbHover: string;
  tabActive: string;
  tabActiveLight?: string;
  paneBorderActive: string;
  paneBorderActiveLight?: string;
  sidebarActive: string;
  groupLabelBg?: string;
  groupLabelFg?: string;
  paneBorderGlow?: number;
}

// ── Terminal Theme ───────────────────────────────────────────────────────────

export interface AnsiColors {
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export interface TerminalTheme {
  id: string;
  name: string;
  foreground: string;
  background: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  selectionForeground: string;
  selectionInactiveBackground: string;
  ansi: AnsiColors;
  fontSize: number;
  fontFamily: string;
}

// ── Built-in UI Themes ───────────────────────────────────────────────────────

const darkUI: UITheme = {
  id: 'dark',
  name: 'Dark',
  bgPrimary: '#0d0e10',
  bgSecondary: '#181a1c',
  bgTertiary: '#242629',
  bgHover: '#1e2022',
  bgActive: '#242629',
  textPrimary: '#fdfbfe',
  textSecondary: '#ababad',
  textMuted: '#757578',
  border: '#47484a',
  accent: '#969696',
  accentHover: '#828282',
  destructive: '#ff6e84',
  destructiveHover: '#a70138',
  scrollbarThumb: 'rgba(117,117,120,0.4)',
  scrollbarThumbHover: 'rgba(117,117,120,0.7)',
  tabActive: '#fdfbfe',
  tabActiveLight: '#333333',
  paneBorderActive: '#969696',
  paneBorderActiveLight: '#8a8a8a',
  sidebarActive: '#bfbfbf',
};

const lightUI: UITheme = {
  id: 'light',
  name: 'Light',
  bgPrimary: '#ffffff',
  bgSecondary: '#f3f3f3',
  bgTertiary: '#e8e8e8',
  bgHover: '#0060c0',
  bgActive: '#e8e8e8',
  textPrimary: '#333333',
  textSecondary: '#666666',
  textMuted: '#999999',
  border: '#d4d4d4',
  accent: '#c9c9c9',
  accentHover: '#b5b5b5',
  destructive: '#d32f2f',
  destructiveHover: '#fdd',
  scrollbarThumb: 'rgba(100,100,100,0.4)',
  scrollbarThumbHover: 'rgba(100,100,100,0.7)',
  tabActive: '#c9c9c9',
  tabActiveLight: '#333333',
  paneBorderActive: '#c9c9c9',
  paneBorderActiveLight: '#a8a8a8',
  sidebarActive: '#c9c9c9',
};

const darkGreenUI: UITheme = {
  id: 'dark-green',
  name: 'Dark Green',
  bgPrimary: '#0d0e10',
  bgSecondary: '#181a1c',
  bgTertiary: '#242629',
  bgHover: '#1e2022',
  bgActive: '#242629',
  textPrimary: '#fdfbfe',
  textSecondary: '#ababad',
  textMuted: '#757578',
  border: '#47484a',
  accent: '#009e00',
  accentHover: '#008a00',
  destructive: '#ff6e84',
  destructiveHover: '#a70138',
  scrollbarThumb: 'rgba(117,117,120,0.4)',
  scrollbarThumbHover: 'rgba(117,117,120,0.7)',
  tabActive: 'rgba(255,255,255,0.86)',
  tabActiveLight: '#008a00',
  paneBorderActive: 'rgba(0,209,0,0.75)',
  paneBorderActiveLight: '#00ad00',
  sidebarActive: 'rgba(0,204,0,0.7)',
  groupLabelBg: '#03ce03',
  groupLabelFg: '#0d0e10',
  paneBorderGlow: 0.1,
};

const classicBlueUI: UITheme = {
  id: 'classic-blue',
  name: 'Classic Blue',
  bgPrimary: '#0d0e10',
  bgSecondary: '#181a1c',
  bgTertiary: '#242629',
  bgHover: '#1e2022',
  bgActive: '#242629',
  textPrimary: '#fdfbfe',
  textSecondary: '#ababad',
  textMuted: '#757578',
  border: '#47484a',
  accent: '#a0a7ff',
  accentHover: '#8c93eb',
  destructive: '#ff6e84',
  destructiveHover: '#a70138',
  scrollbarThumb: 'rgba(117,117,120,0.4)',
  scrollbarThumbHover: 'rgba(117,117,120,0.7)',
  tabActive: '#a0a7ff',
  paneBorderActive: '#a0a7ff',
  paneBorderActiveLight: '#a0a7ff',
  sidebarActive: '#a0a7ff',
  groupLabelBg: '#fdfbfe',
  groupLabelFg: '#0d0e10',
  paneBorderGlow: 0.2,
};

export const BUILT_IN_UI_THEMES: readonly UITheme[] = [darkUI, lightUI, darkGreenUI, classicBlueUI];

// ── Built-in Terminal Themes ─────────────────────────────────────────────────

const ANSI_DARK: AnsiColors = {
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
};

const ANSI_LIGHT: AnsiColors = {
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

const ANSI_GREEN: AnsiColors = {
  black: '#000000',
  red: '#cd3131',
  green: '#00cc00',
  yellow: '#cccc00',
  blue: '#2472c8',
  magenta: '#bc3fbc',
  cyan: '#11a8cd',
  white: '#00cc00',
  brightBlack: '#555555',
  brightRed: '#f14c4c',
  brightGreen: '#33ff33',
  brightYellow: '#ffff33',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#33ff33',
};

const darkTerminal: TerminalTheme = {
  id: 'dark',
  name: 'Dark',
  foreground: '#cacaca',
  background: '#000000',
  cursor: '#fdfbfe',
  cursorAccent: '#000000',
  selectionBackground: '#707070',
  selectionForeground: '#fdfbfe',
  selectionInactiveBackground: '#242629',
  ansi: ANSI_DARK,
  fontSize: 14,
  fontFamily: 'Menlo',
};

const lightTerminal: TerminalTheme = {
  id: 'light',
  name: 'Light',
  foreground: '#333333',
  background: '#fdfbfb',
  cursor: '#333333',
  cursorAccent: '#fdfbfb',
  selectionBackground: '#c9c9c9',
  selectionForeground: '#000000',
  selectionInactiveBackground: '#d6ebff',
  ansi: ANSI_LIGHT,
  fontSize: 14,
  fontFamily: 'Menlo',
};

const darkGreenTerminal: TerminalTheme = {
  id: 'dark-green',
  name: 'Dark Green',
  foreground: '#00cc00',
  background: '#0a0a0a',
  cursor: '#00cc00',
  cursorAccent: '#0a0a0a',
  selectionBackground: '#002400',
  selectionForeground: '#33ff33',
  selectionInactiveBackground: '#1a2a1a',
  ansi: ANSI_GREEN,
  fontSize: 14,
  fontFamily: 'Menlo',
};

const ANSI_BLUE: AnsiColors = {
  black: '#000020',
  red: '#ff6e6e',
  green: '#54ff54',
  yellow: '#ffff54',
  blue: '#5454ff',
  magenta: '#ff54ff',
  cyan: '#54ffff',
  white: '#ffffff',
  brightBlack: '#555580',
  brightRed: '#ff8a8a',
  brightGreen: '#70ff70',
  brightYellow: '#ffff70',
  brightBlue: '#7070ff',
  brightMagenta: '#ff70ff',
  brightCyan: '#70ffff',
  brightWhite: '#ffffff',
};

const classicBlueTerminal: TerminalTheme = {
  id: 'classic-blue',
  name: 'Classic Blue',
  foreground: '#ffffff',
  background: '#0000aa',
  cursor: '#ffffff',
  cursorAccent: '#0000aa',
  selectionBackground: '#3333cc',
  selectionForeground: '#ffffff',
  selectionInactiveBackground: '#2222aa',
  ansi: ANSI_BLUE,
  fontSize: 14,
  fontFamily: 'Menlo',
};

export const BUILT_IN_TERMINAL_THEMES: readonly TerminalTheme[] = [
  darkTerminal,
  lightTerminal,
  darkGreenTerminal,
  classicBlueTerminal,
];

export const BUILT_IN_UI_THEME_IDS = new Set(BUILT_IN_UI_THEMES.map(t => t.id));
export const BUILT_IN_TERMINAL_THEME_IDS = new Set(BUILT_IN_TERMINAL_THEMES.map(t => t.id));
