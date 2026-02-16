<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import ColorPicker from './ColorPicker.svelte';
  import {
    addCustomUITheme,
    addCustomTerminalTheme,
  } from '../lib/themeStore';
  import {
    settingsStore,
    FONT_FAMILIES,
    CURSOR_STYLES,
    DEFAULT_SETTINGS,
    type TerminalSettings,
  } from '../lib/settingsStore';
  import {
    BUILT_IN_UI_THEMES,
    BUILT_IN_TERMINAL_THEMES,
    type UITheme,
    type TerminalTheme,
  } from '../lib/themeTypes';

  export let isOpen: boolean = false;

  const dispatch = createEventDispatcher<{ close: void; save: void }>();

  let themeName = '';
  let baseThemeId = 'dark';

  // Color state cloned from the selected base theme
  let foreground = '';
  let background = '';
  let cursor = '';
  let selectionBackground = '';

  // Font/cursor state from settingsStore
  let settings: TerminalSettings = DEFAULT_SETTINGS;
  const unsubscribe = settingsStore.subscribe((value) => {
    settings = value;
  });

  function initColorsFromBase() {
    const baseTerm = BUILT_IN_TERMINAL_THEMES.find(t => t.id === baseThemeId) ?? BUILT_IN_TERMINAL_THEMES[0];
    foreground = baseTerm.foreground;
    background = baseTerm.background;
    cursor = baseTerm.cursor;
    selectionBackground = baseTerm.selectionBackground;
  }

  // Initialize colors when editor opens or base theme changes
  $: if (isOpen) {
    initColorsFromBase();
  }

  // When base theme changes while editor is open, re-initialize
  function handleBaseThemeChange(event: Event) {
    const target = event.target as HTMLSelectElement;
    baseThemeId = target.value;
    initColorsFromBase();
  }

  function generateId(): string {
    return `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function handleCancel() {
    themeName = '';
    baseThemeId = 'dark';
    dispatch('close');
  }

  function handleSave() {
    if (!themeName.trim()) return;

    const baseUI = BUILT_IN_UI_THEMES.find(t => t.id === baseThemeId) ?? BUILT_IN_UI_THEMES[0];
    const baseTerm = BUILT_IN_TERMINAL_THEMES.find(t => t.id === baseThemeId) ?? BUILT_IN_TERMINAL_THEMES[0];

    const customUI: UITheme = {
      ...baseUI,
      id: generateId(),
      name: themeName.trim(),
    };

    const customTerm: TerminalTheme = {
      ...baseTerm,
      id: generateId(),
      name: themeName.trim(),
      foreground,
      background,
      cursor,
      cursorAccent: background,
      selectionBackground,
      ansi: { ...baseTerm.ansi },
    };

    addCustomUITheme(customUI);
    addCustomTerminalTheme(customTerm);

    themeName = '';
    baseThemeId = 'dark';
    dispatch('save');
  }

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) {
      handleCancel();
    }
  }

  // Font/cursor handlers — update settingsStore directly (global, not per-theme)
  function handleFontSizeChange(event: Event) {
    const target = event.target as HTMLInputElement;
    settingsStore.updateSetting('fontSize', parseInt(target.value, 10));
  }

  function handleFontFamilyChange(event: Event) {
    const target = event.target as HTMLSelectElement;
    settingsStore.updateSetting('fontFamily', target.value);
  }

  function handleCursorStyleChange(event: Event) {
    const target = event.target as HTMLSelectElement;
    settingsStore.updateSetting('cursorStyle', target.value as 'block' | 'underline' | 'bar');
  }

  function handleCursorBlinkChange(event: Event) {
    const target = event.target as HTMLInputElement;
    settingsStore.updateSetting('cursorBlink', target.checked);
  }

  // Color handlers — update local state (saved into the custom theme on Save)
  function handleForegroundChange(event: CustomEvent<string>) {
    foreground = event.detail;
  }

  function handleBackgroundChange(event: CustomEvent<string>) {
    background = event.detail;
  }

  function handleCursorColorChange(event: CustomEvent<string>) {
    cursor = event.detail;
  }

  function handleSelectionBgChange(event: CustomEvent<string>) {
    selectionBackground = event.detail;
  }

  import { onDestroy } from 'svelte';
  onDestroy(() => {
    unsubscribe();
  });
</script>

{#if isOpen}
  <div class="modal-backdrop" on:click={handleBackdropClick} role="dialog" aria-modal="true">
    <div class="editor-panel">
      <div class="panel-header">
        <h2>Create Custom Theme</h2>
      </div>

      <div class="panel-content">
        <div class="field">
          <label for="themeName">Theme Name</label>
          <input
            id="themeName"
            type="text"
            bind:value={themeName}
            placeholder="My Custom Theme"
          />
        </div>

        <div class="field">
          <label for="baseTheme">Base Theme</label>
          <select id="baseTheme" value={baseThemeId} on:change={handleBaseThemeChange}>
            {#each BUILT_IN_UI_THEMES as theme}
              <option value={theme.id}>{theme.name}</option>
            {/each}
          </select>
        </div>

        <div class="section-label">Terminal Colors</div>

        <div class="field">
          <ColorPicker
            id="themeEditorForeground"
            label="Foreground"
            value={foreground}
            on:change={handleForegroundChange}
          />
        </div>

        <div class="field">
          <ColorPicker
            id="themeEditorBackground"
            label="Background"
            value={background}
            on:change={handleBackgroundChange}
          />
        </div>

        <div class="field">
          <ColorPicker
            id="themeEditorCursor"
            label="Cursor"
            value={cursor}
            on:change={handleCursorColorChange}
          />
        </div>

        <div class="field">
          <ColorPicker
            id="themeEditorSelection"
            label="Selection Background"
            value={selectionBackground}
            on:change={handleSelectionBgChange}
          />
        </div>

        <div class="section-label">Font &amp; Cursor</div>

        <div class="field">
          <label for="themeEditorFontSize">
            Font Size: <span class="value">{settings.fontSize}px</span>
          </label>
          <input
            type="range"
            id="themeEditorFontSize"
            min="10"
            max="24"
            step="1"
            value={settings.fontSize}
            on:input={handleFontSizeChange}
          />
        </div>

        <div class="field">
          <label for="themeEditorFontFamily">Font Family</label>
          <select
            id="themeEditorFontFamily"
            value={settings.fontFamily}
            on:change={handleFontFamilyChange}
          >
            {#each FONT_FAMILIES as font}
              <option value={font}>{font}</option>
            {/each}
          </select>
        </div>

        <div class="field">
          <label for="themeEditorCursorStyle">Cursor Style</label>
          <select
            id="themeEditorCursorStyle"
            value={settings.cursorStyle}
            on:change={handleCursorStyleChange}
          >
            {#each CURSOR_STYLES as style}
              <option value={style}>{style.charAt(0).toUpperCase() + style.slice(1)}</option>
            {/each}
          </select>
        </div>

        <div class="field toggle-field">
          <label for="themeEditorCursorBlink">Cursor Blink</label>
          <label class="toggle">
            <input
              type="checkbox"
              id="themeEditorCursorBlink"
              checked={settings.cursorBlink}
              on:change={handleCursorBlinkChange}
            />
            <span class="slider"></span>
          </label>
        </div>
      </div>

      <div class="panel-footer">
        <button class="btn-cancel" on:click={handleCancel}>Cancel</button>
        <button class="btn-save" on:click={handleSave} disabled={!themeName.trim()}>Save</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1100;
  }

  .editor-panel {
    background: var(--ui-bg-secondary, #252526);
    border: 1px solid var(--ui-border, #3c3c3c);
    border-radius: 8px;
    width: 420px;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  }

  .panel-header {
    padding: 16px 20px;
    border-bottom: 1px solid var(--ui-border, #3c3c3c);
    flex-shrink: 0;
  }

  .panel-header h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 500;
    color: var(--ui-text-primary, #e0e0e0);
  }

  .panel-content {
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  }

  .section-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--ui-text-primary, #e0e0e0);
    border-bottom: 1px solid var(--ui-border, #3c3c3c);
    padding-bottom: 4px;
    margin-top: 4px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .field label {
    font-size: 12px;
    color: var(--ui-text-secondary, #999);
    font-weight: 500;
  }

  .field .value {
    color: var(--ui-text-primary, #cccccc);
    font-weight: 400;
    margin-left: 4px;
  }

  .field input[type="text"],
  .field select {
    padding: 8px 12px;
    background: var(--ui-bg-tertiary, #3c3c3c);
    border: 1px solid var(--ui-border, #555);
    border-radius: 4px;
    color: var(--ui-text-primary, white);
    font-size: 13px;
  }

  .field input[type="text"]:focus,
  .field select:focus {
    outline: none;
    border-color: var(--ui-accent, #0e639c);
  }

  .field input[type="range"] {
    width: 100%;
    height: 4px;
    -webkit-appearance: none;
    appearance: none;
    background: var(--ui-bg-tertiary, #3c3c3c);
    border-radius: 2px;
    outline: none;
  }

  .field input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 16px;
    height: 16px;
    background: var(--ui-accent, #0e639c);
    border-radius: 50%;
    cursor: pointer;
    transition: background 0.15s;
  }

  .field input[type="range"]::-webkit-slider-thumb:hover {
    background: var(--ui-accent-hover, #1177bb);
  }

  .field input[type="range"]::-moz-range-thumb {
    width: 16px;
    height: 16px;
    background: var(--ui-accent, #0e639c);
    border-radius: 50%;
    cursor: pointer;
    border: none;
  }

  .toggle-field {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }

  .toggle {
    position: relative;
    display: inline-block;
    width: 44px;
    height: 24px;
  }

  .toggle input {
    opacity: 0;
    width: 0;
    height: 0;
  }

  .slider {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: var(--ui-bg-tertiary, #3c3c3c);
    transition: 0.2s;
    border-radius: 24px;
  }

  .slider:before {
    position: absolute;
    content: "";
    height: 18px;
    width: 18px;
    left: 3px;
    bottom: 3px;
    background-color: var(--ui-text-primary, white);
    transition: 0.2s;
    border-radius: 50%;
  }

  .toggle input:checked + .slider {
    background-color: var(--ui-accent, #0e639c);
  }

  .toggle input:checked + .slider:before {
    transform: translateX(20px);
  }

  .panel-footer {
    padding: 16px 20px;
    border-top: 1px solid var(--ui-border, #3c3c3c);
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    flex-shrink: 0;
  }

  .btn-cancel {
    padding: 8px 16px;
    background: var(--ui-bg-tertiary, #3c3c3c);
    border: 1px solid var(--ui-border, #555);
    border-radius: 4px;
    color: var(--ui-text-primary, #ccc);
    font-size: 13px;
    cursor: pointer;
  }

  .btn-cancel:hover {
    background: var(--ui-bg-hover, #4a4a4a);
  }

  .btn-save {
    padding: 8px 16px;
    background: var(--ui-accent, #0e639c);
    border: none;
    border-radius: 4px;
    color: white;
    font-size: 13px;
    cursor: pointer;
  }

  .btn-save:hover {
    background: var(--ui-accent-hover, #1177bb);
  }

  .btn-save:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
