import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, screen, cleanup } from '@testing-library/svelte';
import { get } from 'svelte/store';
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

import { themeState, addCustomUITheme, addCustomTerminalTheme } from '../lib/themeStore';
import { settingsStore } from '../lib/settingsStore';

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

  it('font size slider updates settingsStore', async () => {
    const spy = vi.spyOn(settingsStore, 'updateSetting');
    render(ThemeEditor, { props: { isOpen: true } });
    const slider = document.querySelector('#themeEditorFontSize') as HTMLInputElement;
    expect(slider).toBeTruthy();
    await fireEvent.input(slider, { target: { value: '18' } });
    expect(spy).toHaveBeenCalledWith('fontSize', 18);
    spy.mockRestore();
  });

  it('font family select updates settingsStore', async () => {
    const spy = vi.spyOn(settingsStore, 'updateSetting');
    render(ThemeEditor, { props: { isOpen: true } });
    const select = document.querySelector('#themeEditorFontFamily') as HTMLSelectElement;
    expect(select).toBeTruthy();
    await fireEvent.change(select, { target: { value: 'Fira Code' } });
    expect(spy).toHaveBeenCalledWith('fontFamily', 'Fira Code');
    spy.mockRestore();
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

    const state = get(themeState);
    expect(state.customUIThemes.length).toBeGreaterThan(0);
    expect(state.customTerminalThemes.length).toBeGreaterThan(0);
    expect(state.customUIThemes[0].name).toBe('My Custom Theme');
    expect(state.customTerminalThemes[0].name).toBe('My Custom Theme');

    // Verify the terminal theme has color fields from the base theme (dark defaults)
    const termTheme = state.customTerminalThemes[0];
    expect(termTheme.foreground).toBe('#cccccc');
    expect(termTheme.background).toBe('#1e1e1e');
    expect(termTheme.cursor).toBe('#cccccc');
    expect(termTheme.selectionBackground).toBe('#264f78');
  });
});
