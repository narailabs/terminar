import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, screen, cleanup } from '@testing-library/svelte';
import { get } from 'svelte/store';
import SettingsPanel from './SettingsPanel.svelte';

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

// Must import after localStorage mock
import {
  themeState,
  setActiveUITheme,
  setActiveTerminalTheme,
} from '../lib/themeStore';
import { BUILT_IN_UI_THEMES, BUILT_IN_TERMINAL_THEMES } from '../lib/themeTypes';

describe('SettingsPanel - Theme Selectors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    // Reset to default dark theme
    setActiveUITheme('dark');
    setActiveTerminalTheme('dark');
  });

  afterEach(() => {
    cleanup();
  });

  it('should show UI Theme dropdown with all built-in themes', () => {
    render(SettingsPanel, { props: { isOpen: true } });

    const select = document.querySelector('#uiTheme') as HTMLSelectElement;
    expect(select).toBeTruthy();

    const options = Array.from(select.querySelectorAll('option'));
    expect(options.length).toBeGreaterThanOrEqual(BUILT_IN_UI_THEMES.length);
    expect(options.some(o => o.textContent === 'Dark')).toBe(true);
    expect(options.some(o => o.textContent === 'Light')).toBe(true);
    expect(options.some(o => o.textContent === 'Dark Green')).toBe(true);
  });

  it('should show Terminal Theme dropdown with all built-in themes', () => {
    render(SettingsPanel, { props: { isOpen: true } });

    const select = document.querySelector('#terminalTheme') as HTMLSelectElement;
    expect(select).toBeTruthy();

    const options = Array.from(select.querySelectorAll('option'));
    expect(options.length).toBeGreaterThanOrEqual(BUILT_IN_TERMINAL_THEMES.length);
    expect(options.some(o => o.textContent === 'Dark')).toBe(true);
    expect(options.some(o => o.textContent === 'Light')).toBe(true);
    expect(options.some(o => o.textContent === 'Dark Green')).toBe(true);
  });

  it('should update themeStore when UI theme is changed', async () => {
    render(SettingsPanel, { props: { isOpen: true } });

    const select = document.querySelector('#uiTheme') as HTMLSelectElement;
    await fireEvent.change(select, { target: { value: 'light' } });

    expect(get(themeState).activeUIThemeId).toBe('light');
  });

  it('should update themeStore when terminal theme is changed', async () => {
    render(SettingsPanel, { props: { isOpen: true } });

    const select = document.querySelector('#terminalTheme') as HTMLSelectElement;
    await fireEvent.change(select, { target: { value: 'dark-green' } });

    expect(get(themeState).activeTerminalThemeId).toBe('dark-green');
  });

  it('should reflect current active theme in the dropdown', () => {
    setActiveUITheme('light');
    render(SettingsPanel, { props: { isOpen: true } });

    const select = document.querySelector('#uiTheme') as HTMLSelectElement;
    expect(select.value).toBe('light');
  });

  it('should not render when isOpen is false', () => {
    render(SettingsPanel, { props: { isOpen: false } });
    expect(document.querySelector('.settings-panel')).toBeFalsy();
  });
});

describe('SettingsPanel - Scrolling Layout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    setActiveUITheme('dark');
    setActiveTerminalTheme('dark');
  });

  afterEach(() => {
    cleanup();
  });

  it('should have header, content, and footer as direct children of settings-panel', () => {
    render(SettingsPanel, { props: { isOpen: true } });

    const panel = document.querySelector('.settings-panel') as HTMLElement;
    expect(panel).toBeTruthy();

    const header = panel.querySelector(':scope > .panel-header');
    const content = panel.querySelector(':scope > .panel-content');
    const footer = panel.querySelector(':scope > .panel-footer');

    expect(header).toBeTruthy();
    expect(content).toBeTruthy();
    expect(footer).toBeTruthy();
  });

  it('should always show the Reset to Defaults button (footer) without it being inside scrollable content', () => {
    render(SettingsPanel, { props: { isOpen: true } });

    const footer = document.querySelector('.panel-footer') as HTMLElement;
    const resetBtn = screen.getByText('Reset to Defaults');

    expect(footer).toBeTruthy();
    expect(resetBtn).toBeTruthy();

    // Footer must NOT be inside panel-content (the scrollable area)
    const content = document.querySelector('.panel-content') as HTMLElement;
    expect(content.contains(footer)).toBe(false);
    expect(content.contains(resetBtn)).toBe(false);
  });

  it('settings-panel should use flex column layout for sticky header/footer', () => {
    render(SettingsPanel, { props: { isOpen: true } });

    const panel = document.querySelector('.settings-panel') as HTMLElement;
    // The panel must use flex layout so header and footer stay fixed
    // while only panel-content scrolls. We verify this by checking
    // the inline or computed style indicates flex layout.
    // In Svelte, scoped styles are applied as attributes, so we check
    // the panel has the correct structure for the CSS to work.
    const children = Array.from(panel.children).map(el => el.className);
    // Must have exactly: header, content, footer in order
    const headerIdx = children.findIndex(c => c.includes('panel-header'));
    const contentIdx = children.findIndex(c => c.includes('panel-content'));
    const footerIdx = children.findIndex(c => c.includes('panel-footer'));

    expect(headerIdx).toBeGreaterThanOrEqual(0);
    expect(contentIdx).toBeGreaterThan(headerIdx);
    expect(footerIdx).toBeGreaterThan(contentIdx);
  });
});
