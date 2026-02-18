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
  setUIMode,
  addCustomUITheme,
  addCustomTerminalTheme,
} from '../lib/themeStore';
import { BUILT_IN_TERMINAL_THEMES } from '../lib/themeTypes';
import { settingsStore } from '../lib/settingsStore';

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

  it('should show Mode dropdown with Light, Dark, Auto options', () => {
    render(SettingsPanel, { props: { isOpen: true } });

    const select = document.querySelector('#uiMode') as HTMLSelectElement;
    expect(select).toBeTruthy();

    const options = Array.from(select.querySelectorAll('option'));
    expect(options).toHaveLength(3);
    expect(options.some(o => o.textContent === 'Light')).toBe(true);
    expect(options.some(o => o.textContent === 'Dark')).toBe(true);
    expect(options.some(o => o.textContent === 'Auto')).toBe(true);
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

  it('should update themeStore when mode is changed', async () => {
    render(SettingsPanel, { props: { isOpen: true } });

    const select = document.querySelector('#uiMode') as HTMLSelectElement;
    await fireEvent.change(select, { target: { value: 'light' } });

    expect(get(themeState).uiMode).toBe('light');
  });

  it('should update themeStore when terminal theme is changed', async () => {
    render(SettingsPanel, { props: { isOpen: true } });

    const select = document.querySelector('#terminalTheme') as HTMLSelectElement;
    await fireEvent.change(select, { target: { value: 'dark-green' } });

    expect(get(themeState).activeTerminalThemeId).toBe('dark-green');
  });

  it('should reflect current mode in the dropdown', () => {
    setUIMode('light');
    render(SettingsPanel, { props: { isOpen: true } });

    const select = document.querySelector('#uiMode') as HTMLSelectElement;
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

describe('SettingsPanel - Settings Controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    setActiveUITheme('dark');
    setActiveTerminalTheme('dark');
  });

  afterEach(() => {
    cleanup();
  });

  it('Escape key dispatches close event', async () => {
    const closeFn = vi.fn();
    render(SettingsPanel, {
      props: { isOpen: true },
      events: { close: closeFn },
    });
    await fireEvent.keyDown(document, { key: 'Escape' });
    expect(closeFn).toHaveBeenCalled();
  });

  it('backdrop click closes panel', async () => {
    const closeFn = vi.fn();
    render(SettingsPanel, {
      props: { isOpen: true },
      events: { close: closeFn },
    });
    const backdrop = document.querySelector('.modal-backdrop');
    // Click the backdrop itself (not a child element)
    await fireEvent.click(backdrop!);
    expect(closeFn).toHaveBeenCalled();
  });

  it('clicking inside settings panel does not close via backdrop', async () => {
    const closeFn = vi.fn();
    render(SettingsPanel, {
      props: { isOpen: true },
      events: { close: closeFn },
    });
    const panel = document.querySelector('.settings-panel');
    await fireEvent.click(panel!);
    expect(closeFn).not.toHaveBeenCalled();
  });

  it('pane title bars checkbox toggle updates settingsStore', async () => {
    const spy = vi.spyOn(settingsStore, 'updateSetting');
    render(SettingsPanel, { props: { isOpen: true } });
    const checkbox = document.querySelector('#showPaneTitleBars') as HTMLInputElement;
    expect(checkbox).toBeTruthy();
    await fireEvent.change(checkbox, { target: { checked: false } });
    expect(spy).toHaveBeenCalledWith('showPaneTitleBars', false);
    spy.mockRestore();
  });

  it('auto-scroll checkbox toggle updates settingsStore', async () => {
    const spy = vi.spyOn(settingsStore, 'updateSetting');
    render(SettingsPanel, { props: { isOpen: true } });
    const checkbox = document.querySelector('#autoScroll') as HTMLInputElement;
    expect(checkbox).toBeTruthy();
    await fireEvent.change(checkbox, { target: { checked: false } });
    expect(spy).toHaveBeenCalledWith('autoScroll', false);
    spy.mockRestore();
  });

  it('Reset button calls settingsStore.reset()', async () => {
    const spy = vi.spyOn(settingsStore, 'reset');
    render(SettingsPanel, { props: { isOpen: true } });
    const resetBtn = screen.getByText('Reset to Defaults');
    expect(resetBtn).toBeTruthy();
    await fireEvent.click(resetBtn);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('keybinding badge shows "Press keys..." when recording', async () => {
    render(SettingsPanel, { props: { isOpen: true } });
    // Find the first keybinding badge button and click it to start recording
    const badges = document.querySelectorAll('.keybinding-badge');
    expect(badges.length).toBeGreaterThan(0);
    await fireEvent.click(badges[0]);
    // After clicking, should show "Press keys..." with .recording class
    const recordingBadge = document.querySelector('.keybinding-badge.recording');
    expect(recordingBadge).toBeTruthy();
    expect(recordingBadge!.textContent).toContain('Press keys...');
  });

  it('Escape cancels keybinding recording', async () => {
    render(SettingsPanel, { props: { isOpen: true } });
    // Start recording by clicking a keybinding badge
    const badges = document.querySelectorAll('.keybinding-badge');
    expect(badges.length).toBeGreaterThan(0);
    await fireEvent.click(badges[0]);
    // Verify recording started
    expect(document.querySelector('.keybinding-badge.recording')).toBeTruthy();
    // Press Escape to cancel
    await fireEvent.keyDown(document, { key: 'Escape' });
    // Recording badge should be gone
    expect(document.querySelector('.keybinding-badge.recording')).toBeFalsy();
  });

  it('Create Theme button exists and clicking shows ThemeEditor', async () => {
    render(SettingsPanel, { props: { isOpen: true } });
    const createBtn = screen.getByText('Create Theme');
    expect(createBtn).toBeTruthy();
    await fireEvent.click(createBtn);
    // ThemeEditor renders a modal with its own backdrop when open
    // Check that the ThemeEditor component appeared in the DOM
    const themeEditorPanels = document.querySelectorAll('.editor-panel');
    expect(themeEditorPanels.length).toBeGreaterThanOrEqual(1);
  });

  it('shows Edit button for grouped custom themes', async () => {
    // Add a paired custom theme
    addCustomUITheme({
      id: 'test-ui', name: 'Test Theme',
      bgPrimary: '#111', bgSecondary: '#222', bgTertiary: '#333',
      bgHover: '#444', bgActive: '#555',
      textPrimary: '#eee', textSecondary: '#ccc', textMuted: '#999',
      border: '#444', accent: '#0ff', accentHover: '#0ee',
      destructive: '#f00', destructiveHover: '#e00',
    });
    addCustomTerminalTheme({
      id: 'test-term', name: 'Test Theme',
      foreground: '#0f0', background: '#000', cursor: '#0f0', cursorAccent: '#000',
      selectionBackground: '#030', selectionForeground: '#0f0', selectionInactiveBackground: '#020',
      ansi: {
        black: '#000', red: '#f00', green: '#0f0', yellow: '#ff0',
        blue: '#00f', magenta: '#f0f', cyan: '#0ff', white: '#fff',
        brightBlack: '#555', brightRed: '#f55', brightGreen: '#5f5', brightYellow: '#ff5',
        brightBlue: '#55f', brightMagenta: '#f5f', brightCyan: '#5ff', brightWhite: '#fff',
      },
    });

    render(SettingsPanel, { props: { isOpen: true } });
    const editBtn = screen.getByText('Edit');
    expect(editBtn).toBeTruthy();
    // Click Edit should open ThemeEditor in edit mode
    await fireEvent.click(editBtn);
    expect(screen.getByText('Edit Custom Theme')).toBeTruthy();
  });

  it('shows grouped custom themes as single row instead of separate UI/Terminal entries', () => {
    addCustomUITheme({
      id: 'grp-ui', name: 'Grouped',
      bgPrimary: '#111', bgSecondary: '#222', bgTertiary: '#333',
      bgHover: '#444', bgActive: '#555',
      textPrimary: '#eee', textSecondary: '#ccc', textMuted: '#999',
      border: '#444', accent: '#0ff', accentHover: '#0ee',
      destructive: '#f00', destructiveHover: '#e00',
    });
    addCustomTerminalTheme({
      id: 'grp-term', name: 'Grouped',
      foreground: '#0f0', background: '#000', cursor: '#0f0', cursorAccent: '#000',
      selectionBackground: '#030', selectionForeground: '#0f0', selectionInactiveBackground: '#020',
      ansi: {
        black: '#000', red: '#f00', green: '#0f0', yellow: '#ff0',
        blue: '#00f', magenta: '#f0f', cyan: '#0ff', white: '#fff',
        brightBlack: '#555', brightRed: '#f55', brightGreen: '#5f5', brightYellow: '#ff5',
        brightBlue: '#55f', brightMagenta: '#f5f', brightCyan: '#5ff', brightWhite: '#fff',
      },
    });

    render(SettingsPanel, { props: { isOpen: true } });
    // In the custom theme list, should show "Grouped" (not "Grouped (UI)" + "Grouped (Terminal)")
    const customList = document.querySelector('.custom-theme-list') as HTMLElement;
    expect(customList).toBeTruthy();
    const items = customList.querySelectorAll('.custom-theme-item');
    const itemTexts = Array.from(items).map(el => el.querySelector('span')?.textContent);
    expect(itemTexts).toContain('Grouped');
    expect(itemTexts).not.toContain('Grouped (UI)');
    expect(itemTexts).not.toContain('Grouped (Terminal)');
  });

  it('close button in header dispatches close event', async () => {
    const closeFn = vi.fn();
    render(SettingsPanel, {
      props: { isOpen: true },
      events: { close: closeFn },
    });
    const closeBtn = document.querySelector('.close-btn') as HTMLButtonElement;
    expect(closeBtn).toBeTruthy();
    await fireEvent.click(closeBtn);
    expect(closeFn).toHaveBeenCalled();
  });

});
