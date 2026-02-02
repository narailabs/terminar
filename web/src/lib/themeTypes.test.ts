import { describe, it, expect } from 'vitest';
import {
  BUILT_IN_UI_THEMES,
  BUILT_IN_TERMINAL_THEMES,
  type UITheme,
  type TerminalTheme,
} from './themeTypes';

// ── UITheme structure ────────────────────────────────────────────────────────

describe('Built-in UI Themes', () => {
  it('should have exactly 3 built-in UI themes', () => {
    expect(BUILT_IN_UI_THEMES).toHaveLength(3);
  });

  it('should have dark, light, and dark-green themes', () => {
    const ids = BUILT_IN_UI_THEMES.map((t) => t.id);
    expect(ids).toContain('dark');
    expect(ids).toContain('light');
    expect(ids).toContain('dark-green');
  });

  it('each UI theme should have all required color tokens', () => {
    const requiredKeys: (keyof UITheme)[] = [
      'id', 'name',
      'bgPrimary', 'bgSecondary', 'bgTertiary', 'bgHover', 'bgActive',
      'textPrimary', 'textSecondary', 'textMuted',
      'border', 'accent', 'accentHover',
      'destructive', 'destructiveHover',
    ];

    for (const theme of BUILT_IN_UI_THEMES) {
      for (const key of requiredKeys) {
        expect(theme).toHaveProperty(key);
        expect(theme[key]).toBeTruthy();
      }
    }
  });

  it('dark theme should have dark backgrounds', () => {
    const dark = BUILT_IN_UI_THEMES.find((t) => t.id === 'dark')!;
    // Dark backgrounds should have low luminance (start with #1 or #2)
    expect(dark.bgPrimary).toMatch(/^#[0-3]/);
  });

  it('light theme should have light backgrounds', () => {
    const light = BUILT_IN_UI_THEMES.find((t) => t.id === 'light')!;
    // Light backgrounds should have high luminance
    expect(light.bgPrimary).toMatch(/^#[c-fC-F]/);
  });
});

// ── TerminalTheme structure ──────────────────────────────────────────────────

describe('Built-in Terminal Themes', () => {
  it('should have exactly 4 built-in terminal themes', () => {
    expect(BUILT_IN_TERMINAL_THEMES).toHaveLength(4);
  });

  it('should have dark, light, dark-green, and classic-blue themes', () => {
    const ids = BUILT_IN_TERMINAL_THEMES.map((t) => t.id);
    expect(ids).toContain('dark');
    expect(ids).toContain('light');
    expect(ids).toContain('dark-green');
    expect(ids).toContain('classic-blue');
  });

  it('each terminal theme should have foreground, background, cursor, and ansi colors', () => {
    const ansiKeys = [
      'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
      'brightBlack', 'brightRed', 'brightGreen', 'brightYellow',
      'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
    ];

    for (const theme of BUILT_IN_TERMINAL_THEMES) {
      expect(theme.id).toBeTruthy();
      expect(theme.name).toBeTruthy();
      expect(theme.foreground).toBeTruthy();
      expect(theme.background).toBeTruthy();
      expect(theme.cursor).toBeTruthy();
      expect(theme.cursorAccent).toBeTruthy();
      expect(theme.selectionBackground).toBeTruthy();
      expect(theme.selectionForeground).toBeTruthy();
      expect(theme.selectionInactiveBackground).toBeTruthy();
      expect(theme.ansi).toBeDefined();

      for (const key of ansiKeys) {
        expect(theme.ansi).toHaveProperty(key);
        expect((theme.ansi as Record<string, string>)[key]).toBeTruthy();
      }
    }
  });

  it('dark-green terminal theme should have green foreground', () => {
    const green = BUILT_IN_TERMINAL_THEMES.find((t) => t.id === 'dark-green')!;
    // Green hex values typically have high G channel
    const hex = green.foreground.replace('#', '');
    const g = parseInt(hex.substring(2, 4), 16);
    expect(g).toBeGreaterThan(150);
  });

  it('light terminal theme should have light background', () => {
    const light = BUILT_IN_TERMINAL_THEMES.find((t) => t.id === 'light')!;
    expect(light.background).toMatch(/^#[c-fC-F]/);
  });
});
