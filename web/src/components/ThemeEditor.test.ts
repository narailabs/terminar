import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, screen, cleanup } from '@testing-library/svelte';

import ThemeEditor from './ThemeEditor.svelte';

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

import { themeState, addCustomUITheme, addCustomTerminalTheme, updateCustomUITheme, updateCustomTerminalTheme } from '../lib/themeStore.svelte';
import { settingsStore } from '../lib/settingsStore.svelte';
import type { UITheme, TerminalTheme } from '../lib/themeTypes';

describe('ThemeEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('should render when isOpen is true', () => {
    render(ThemeEditor, { props: { isOpen: true } });
    expect(screen.getByText('Create Custom Theme')).toBeTruthy();
  });

  it('should not render when isOpen is false', () => {
    render(ThemeEditor, { props: { isOpen: false } });
    expect(screen.queryByText('Create Custom Theme')).toBeFalsy();
  });

  it('should show theme name input', () => {
    render(ThemeEditor, { props: { isOpen: true } });
    const input = document.querySelector('#themeName') as HTMLInputElement;
    expect(input).toBeTruthy();
  });

  it('should show base theme selector', () => {
    render(ThemeEditor, { props: { isOpen: true } });
    const select = document.querySelector('#baseTheme') as HTMLSelectElement;
    expect(select).toBeTruthy();
  });

  it('should show Save and Cancel buttons', () => {
    render(ThemeEditor, { props: { isOpen: true } });
    expect(screen.getByText('Save')).toBeTruthy();
    expect(screen.getByText('Cancel')).toBeTruthy();
  });

  it('should close dialog when Cancel is clicked', async () => {
    render(ThemeEditor, { props: { isOpen: true } });

    const nameInput = document.querySelector('#themeName') as HTMLInputElement;
    await fireEvent.input(nameInput, { target: { value: 'Something' } });
    await fireEvent.click(screen.getByText('Cancel'));

    expect(nameInput.value).toBe('');
  });

  it('should show color pickers when open', () => {
    render(ThemeEditor, { props: { isOpen: true } });

    expect(document.querySelector('#themeEditorForeground')).toBeTruthy();
    expect(document.querySelector('#themeEditorBackground')).toBeTruthy();
    expect(document.querySelector('#themeEditorCursor')).toBeTruthy();
    expect(document.querySelector('#themeEditorSelection')).toBeTruthy();
  });

  it('should show font and cursor controls when open', () => {
    render(ThemeEditor, { props: { isOpen: true } });

    expect(document.querySelector('#themeEditorFontSize')).toBeTruthy();
    expect(document.querySelector('#themeEditorFontFamily')).toBeTruthy();
    expect(document.querySelector('#themeEditorCursorStyle')).toBeTruthy();
    expect(document.querySelector('#themeEditorCursorBlink')).toBeTruthy();
  });

  it('should show section labels for Terminal Colors and Font & Cursor', () => {
    render(ThemeEditor, { props: { isOpen: true } });

    expect(screen.getByText('Terminal Colors')).toBeTruthy();
    expect(screen.getByText('Font & Cursor')).toBeTruthy();
  });

  it('font size slider updates local state (per-theme, not settingsStore)', async () => {
    render(ThemeEditor, { props: { isOpen: true } });
    const slider = document.querySelector('#themeEditorFontSize') as HTMLInputElement;
    expect(slider).toBeTruthy();
    await fireEvent.input(slider, { target: { value: '18' } });
    // Font size is now per-theme local state, not a settingsStore field
    expect(slider.value).toBe('18');
  });

  it('font family select updates local state (per-theme, not settingsStore)', async () => {
    render(ThemeEditor, { props: { isOpen: true } });
    const select = document.querySelector('#themeEditorFontFamily') as HTMLSelectElement;
    expect(select).toBeTruthy();
    await fireEvent.change(select, { target: { value: 'Fira Code' } });
    // Font family is now per-theme local state, not a settingsStore field
    expect(select.value).toBe('Fira Code');
  });

  it('cursor style select updates settingsStore', async () => {
    const spy = vi.spyOn(settingsStore, 'updateSetting');
    render(ThemeEditor, { props: { isOpen: true } });
    const select = document.querySelector('#themeEditorCursorStyle') as HTMLSelectElement;
    expect(select).toBeTruthy();
    await fireEvent.change(select, { target: { value: 'bar' } });
    expect(spy).toHaveBeenCalledWith('cursorStyle', 'bar');
    spy.mockRestore();
  });

  it('cursor blink checkbox updates settingsStore', async () => {
    const spy = vi.spyOn(settingsStore, 'updateSetting');
    render(ThemeEditor, { props: { isOpen: true } });
    const checkbox = document.querySelector('#themeEditorCursorBlink') as HTMLInputElement;
    expect(checkbox).toBeTruthy();
    await fireEvent.change(checkbox, { target: { checked: false } });
    expect(spy).toHaveBeenCalledWith('cursorBlink', false);
    spy.mockRestore();
  });

  it('should add custom theme with edited colors on Save', async () => {
    render(ThemeEditor, { props: { isOpen: true } });

    const nameInput = document.querySelector('#themeName') as HTMLInputElement;
    await fireEvent.input(nameInput, { target: { value: 'My Custom Theme' } });
    await fireEvent.click(screen.getByText('Save'));

    expect(themeState.value.customUIThemes.length).toBeGreaterThan(0);
    expect(themeState.value.customTerminalThemes.length).toBeGreaterThan(0);
    expect(themeState.value.customUIThemes[0].name).toBe('My Custom Theme');
    expect(themeState.value.customTerminalThemes[0].name).toBe('My Custom Theme');

    // Verify the terminal theme has color fields from the base theme (dark defaults)
    const termTheme = themeState.value.customTerminalThemes[0];
    expect(termTheme.foreground).toBe('#cacaca');
    expect(termTheme.background).toBe('#000000');
    expect(termTheme.cursor).toBe('#fdfbfe');
    expect(termTheme.selectionBackground).toBe('#707070');
  });
});

describe('ThemeEditor - Edit Mode', () => {
  const editUI: UITheme = {
    id: 'custom-edit-ui',
    name: 'My Editable',
    bgPrimary: '#111', bgSecondary: '#222', bgTertiary: '#333',
    bgHover: '#444', bgActive: '#555',
    textPrimary: '#eee', textSecondary: '#ccc', textMuted: '#999',
    border: '#444', accent: '#0ff', accentHover: '#0ee',
    destructive: '#f00', destructiveHover: '#e00',
    scrollbarThumb: 'rgba(100,100,100,0.4)', scrollbarThumbHover: 'rgba(100,100,100,0.7)',
    tabActive: '#0ff', paneBorderActive: '#0ff', sidebarActive: '#0ff',
  };

  const editTerm: TerminalTheme = {
    id: 'custom-edit-term',
    name: 'My Editable',
    foreground: '#00ff00',
    background: '#001100',
    cursor: '#00ff00',
    cursorAccent: '#001100',
    selectionBackground: '#003300',
    selectionForeground: '#00ff00',
    selectionInactiveBackground: '#002200',
    ansi: {
      black: '#000', red: '#f00', green: '#0f0', yellow: '#ff0',
      blue: '#00f', magenta: '#f0f', cyan: '#0ff', white: '#fff',
      brightBlack: '#555', brightRed: '#f55', brightGreen: '#5f5', brightYellow: '#ff5',
      brightBlue: '#55f', brightMagenta: '#f5f', brightCyan: '#5ff', brightWhite: '#fff',
    },
    fontSize: 14,
    fontFamily: 'Menlo',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('should show "Edit Custom Theme" header in edit mode', () => {
    render(ThemeEditor, {
      props: { isOpen: true, editUITheme: editUI, editTerminalTheme: editTerm },
    });
    expect(screen.getByText('Edit Custom Theme')).toBeTruthy();
    expect(screen.queryByText('Create Custom Theme')).toBeFalsy();
  });

  it('should pre-populate theme name from edit props', () => {
    render(ThemeEditor, {
      props: { isOpen: true, editUITheme: editUI, editTerminalTheme: editTerm },
    });
    const input = document.querySelector('#themeName') as HTMLInputElement;
    expect(input.value).toBe('My Editable');
  });

  it('should pre-populate color values from edit terminal theme', () => {
    render(ThemeEditor, {
      props: { isOpen: true, editUITheme: editUI, editTerminalTheme: editTerm },
    });
    const fgInput = document.querySelector('#themeEditorForeground') as HTMLInputElement;
    const bgInput = document.querySelector('#themeEditorBackground') as HTMLInputElement;
    const cursorInput = document.querySelector('#themeEditorCursor') as HTMLInputElement;
    const selInput = document.querySelector('#themeEditorSelection') as HTMLInputElement;

    expect(fgInput.value).toBe('#00ff00');
    expect(bgInput.value).toBe('#001100');
    expect(cursorInput.value).toBe('#00ff00');
    expect(selInput.value).toBe('#003300');
  });

  it('should hide Base Theme selector in edit mode', () => {
    render(ThemeEditor, {
      props: { isOpen: true, editUITheme: editUI, editTerminalTheme: editTerm },
    });
    expect(document.querySelector('#baseTheme')).toBeFalsy();
  });

  it('should call update functions instead of add on save in edit mode', async () => {
    const updateUISpy = vi.spyOn(await import('../lib/themeStore.svelte'), 'updateCustomUITheme');
    const updateTermSpy = vi.spyOn(await import('../lib/themeStore.svelte'), 'updateCustomTerminalTheme');

    // Add the themes first so update has something to work with
    addCustomUITheme(editUI);
    addCustomTerminalTheme(editTerm);

    render(ThemeEditor, {
      props: { isOpen: true, editUITheme: editUI, editTerminalTheme: editTerm },
    });

    await fireEvent.click(screen.getByText('Save'));

    expect(updateUISpy).toHaveBeenCalledWith('custom-edit-ui', expect.objectContaining({ name: 'My Editable' }));
    expect(updateTermSpy).toHaveBeenCalledWith('custom-edit-term', expect.objectContaining({ name: 'My Editable' }));

    updateUISpy.mockRestore();
    updateTermSpy.mockRestore();
  });
});
