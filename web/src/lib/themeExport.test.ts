import { describe, it, expect, vi, beforeEach } from 'vitest';

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

import { exportTheme, importTheme, type ExportedTheme } from './themeExport';
import { BUILT_IN_UI_THEMES, BUILT_IN_TERMINAL_THEMES } from './themeTypes';

describe('Theme Export', () => {
  it('should export a UI theme as JSON', () => {
    const theme = BUILT_IN_UI_THEMES[0]; // dark
    const exported = exportTheme({ ui: theme });

    expect(exported.name).toBe('Dark');
    expect(exported.type).toBe('ui');
    expect(exported.ui).toBeDefined();
    expect(exported.ui!.bgPrimary).toBe('#0d0e10');
    expect(exported.terminal).toBeUndefined();
  });

  it('should export a terminal theme as JSON', () => {
    const theme = BUILT_IN_TERMINAL_THEMES[0]; // dark
    const exported = exportTheme({ terminal: theme });

    expect(exported.name).toBe('Dark');
    expect(exported.type).toBe('terminal');
    expect(exported.terminal).toBeDefined();
    expect(exported.terminal!.foreground).toBe('#fdfbfe');
    expect(exported.ui).toBeUndefined();
  });

  it('should export both UI and terminal as combined theme', () => {
    const ui = BUILT_IN_UI_THEMES[0];
    const terminal = BUILT_IN_TERMINAL_THEMES[0];
    const exported = exportTheme({ ui, terminal, name: 'My Combined' });

    expect(exported.name).toBe('My Combined');
    expect(exported.type).toBe('ui+terminal');
    expect(exported.ui).toBeDefined();
    expect(exported.terminal).toBeDefined();
  });

  it('exported theme should be valid JSON string', () => {
    const theme = BUILT_IN_UI_THEMES[0];
    const exported = exportTheme({ ui: theme });
    const json = JSON.stringify(exported);
    const parsed = JSON.parse(json);
    expect(parsed.name).toBe('Dark');
    expect(parsed.type).toBe('ui');
  });
});

describe('Theme Import', () => {
  it('should import a UI-only theme', () => {
    const data: ExportedTheme = {
      name: 'Imported UI',
      type: 'ui',
      ui: {
        id: 'imported-ui',
        name: 'Imported UI',
        bgPrimary: '#111', bgSecondary: '#222', bgTertiary: '#333',
        bgHover: '#444', bgActive: '#555',
        textPrimary: '#eee', textSecondary: '#ccc', textMuted: '#999',
        border: '#444', accent: '#0ff', accentHover: '#0ee',
        destructive: '#f00', destructiveHover: '#e00',
      },
    };

    const result = importTheme(data);
    expect(result.ui).toBeDefined();
    expect(result.ui!.name).toBe('Imported UI');
    expect(result.terminal).toBeUndefined();
  });

  it('should import a terminal-only theme', () => {
    const data: ExportedTheme = {
      name: 'Imported Term',
      type: 'terminal',
      terminal: {
        id: 'imported-term',
        name: 'Imported Term',
        foreground: '#0f0', background: '#000', cursor: '#0f0', cursorAccent: '#000',
        selectionBackground: '#030', selectionForeground: '#0f0', selectionInactiveBackground: '#020',
        ansi: {
          black: '#000', red: '#f00', green: '#0f0', yellow: '#ff0',
          blue: '#00f', magenta: '#f0f', cyan: '#0ff', white: '#fff',
          brightBlack: '#555', brightRed: '#f55', brightGreen: '#5f5', brightYellow: '#ff5',
          brightBlue: '#55f', brightMagenta: '#f5f', brightCyan: '#5ff', brightWhite: '#fff',
        },
      },
    };

    const result = importTheme(data);
    expect(result.terminal).toBeDefined();
    expect(result.terminal!.name).toBe('Imported Term');
    expect(result.ui).toBeUndefined();
  });

  it('should import a combined ui+terminal theme', () => {
    const data: ExportedTheme = {
      name: 'Imported Both',
      type: 'ui+terminal',
      ui: {
        id: 'imp-ui', name: 'Imported Both',
        bgPrimary: '#111', bgSecondary: '#222', bgTertiary: '#333',
        bgHover: '#444', bgActive: '#555',
        textPrimary: '#eee', textSecondary: '#ccc', textMuted: '#999',
        border: '#444', accent: '#0ff', accentHover: '#0ee',
        destructive: '#f00', destructiveHover: '#e00',
      },
      terminal: {
        id: 'imp-term', name: 'Imported Both',
        foreground: '#0f0', background: '#000', cursor: '#0f0', cursorAccent: '#000',
        selectionBackground: '#030', selectionForeground: '#0f0', selectionInactiveBackground: '#020',
        ansi: {
          black: '#000', red: '#f00', green: '#0f0', yellow: '#ff0',
          blue: '#00f', magenta: '#f0f', cyan: '#0ff', white: '#fff',
          brightBlack: '#555', brightRed: '#f55', brightGreen: '#5f5', brightYellow: '#ff5',
          brightBlue: '#55f', brightMagenta: '#f5f', brightCyan: '#5ff', brightWhite: '#fff',
        },
      },
    };

    const result = importTheme(data);
    expect(result.ui).toBeDefined();
    expect(result.terminal).toBeDefined();
  });

  it('should generate unique IDs for imported themes', () => {
    const data: ExportedTheme = {
      name: 'Test',
      type: 'ui',
      ui: {
        id: 'will-be-replaced', name: 'Test',
        bgPrimary: '#111', bgSecondary: '#222', bgTertiary: '#333',
        bgHover: '#444', bgActive: '#555',
        textPrimary: '#eee', textSecondary: '#ccc', textMuted: '#999',
        border: '#444', accent: '#0ff', accentHover: '#0ee',
        destructive: '#f00', destructiveHover: '#e00',
      },
    };

    const result1 = importTheme(data);
    const result2 = importTheme(data);
    // IDs should be generated fresh each time
    expect(result1.ui!.id).not.toBe('will-be-replaced');
    expect(result1.ui!.id).not.toBe(result2.ui!.id);
  });

  it('should reject import with missing required fields', () => {
    const bad = { name: 'Bad' } as any;
    expect(() => importTheme(bad)).toThrow();
  });
});
