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
    // After cancel, if we re-render with isOpen=true the name should be reset
    render(ThemeEditor, { props: { isOpen: true } });

    const nameInput = document.querySelector('#themeName') as HTMLInputElement;
    await fireEvent.input(nameInput, { target: { value: 'Something' } });
    await fireEvent.click(screen.getByText('Cancel'));

    // The component dispatches 'close' — parent would set isOpen=false
    // We verify the dialog still renders (parent controls isOpen)
    // but the name field was reset by the cancel handler
    expect(nameInput.value).toBe('');
  });

  it('should add custom theme to store on Save with valid name', async () => {
    render(ThemeEditor, { props: { isOpen: true } });

    const nameInput = document.querySelector('#themeName') as HTMLInputElement;
    await fireEvent.input(nameInput, { target: { value: 'My Custom Theme' } });
    await fireEvent.click(screen.getByText('Save'));

    const state = get(themeState);
    // Should have added both UI and terminal custom themes
    expect(state.customUIThemes.length).toBeGreaterThan(0);
    expect(state.customTerminalThemes.length).toBeGreaterThan(0);
    expect(state.customUIThemes[0].name).toBe('My Custom Theme');
    expect(state.customTerminalThemes[0].name).toBe('My Custom Theme');
  });
});
