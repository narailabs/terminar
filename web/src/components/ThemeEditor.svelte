<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import ColorPicker from './ColorPicker.svelte';
  import {
    addCustomUITheme,
    addCustomTerminalTheme,
    updateCustomUITheme,
    updateCustomTerminalTheme,
    upsertCustomUITheme,
    upsertCustomTerminalTheme,
    setActiveUITheme,
    setActiveTerminalTheme,
  } from '../lib/themeStore.svelte';
  import {
    settingsStore,
    FONT_FAMILIES,
    CURSOR_STYLES,
    DEFAULT_SETTINGS,
  } from '../lib/settingsStore.svelte';
  import {
    BUILT_IN_UI_THEMES,
    BUILT_IN_TERMINAL_THEMES,
    type UITheme,
    type TerminalTheme,
  } from '../lib/themeTypes';

  export let isOpen: boolean = false;
  export let editUITheme: UITheme | null = null;
  export let editTerminalTheme: TerminalTheme | null = null;
  export let initialBaseThemeId: string | null = null;
  export let copySourceUI: UITheme | null = null;
  export let copySourceTerminal: TerminalTheme | null = null;

  const dispatch = createEventDispatcher<{ close: void; save: void }>();

  $: isEditMode = editUITheme !== null && editTerminalTheme !== null;
  $: isBuiltInEdit = isEditMode && (
    (editUITheme !== null && BUILT_IN_UI_THEMES.some(t => t.id === editUITheme!.id)) ||
    (editTerminalTheme !== null && BUILT_IN_TERMINAL_THEMES.some(t => t.id === editTerminalTheme!.id))
  );
  $: isCopyMode = !isEditMode && copySourceTerminal !== null;
  $: headerText = isEditMode
    ? (isBuiltInEdit ? 'Edit Theme' : 'Edit Custom Theme')
    : (isCopyMode ? 'Copy Theme' : 'Create Custom Theme');

  let themeName = '';
  let baseThemeId = 'dark';

  // Color state cloned from the selected base theme
  let foreground = '';
  let background = '';
  let cursor = '';
  let selectionBackground = '';

  // UI Chrome color state
  let accent = '';
  let tabActive = '';
  let tabActiveLight = '';
  let paneBorderActive = '';
  let paneBorderActiveLight = '';
  let sidebarActive = '';

  // Font state — per-theme, stored in the terminal theme
  let fontSize = 14;
  let fontFamily = 'Menlo';

  // Cursor settings from global settingsStore
  let cursorStyle: 'block' | 'underline' | 'bar' = DEFAULT_SETTINGS.cursorStyle;
  let cursorBlink = DEFAULT_SETTINGS.cursorBlink;
  const unsubscribe = settingsStore.subscribe((value) => {
    cursorStyle = value.cursorStyle;
    cursorBlink = value.cursorBlink;
  });

  function initFromBase() {
    const baseTerm = BUILT_IN_TERMINAL_THEMES.find(t => t.id === baseThemeId) ?? BUILT_IN_TERMINAL_THEMES[0];
    foreground = baseTerm.foreground;
    background = baseTerm.background;
    cursor = baseTerm.cursor;
    selectionBackground = baseTerm.selectionBackground;
    fontSize = baseTerm.fontSize ?? 14;
    fontFamily = baseTerm.fontFamily ?? 'Menlo';
    const baseUI = BUILT_IN_UI_THEMES.find(t => t.id === baseThemeId) ?? BUILT_IN_UI_THEMES[0];
    const darkUI = BUILT_IN_UI_THEMES.find(t => t.id === 'dark') ?? BUILT_IN_UI_THEMES[0];
    const lightUI = BUILT_IN_UI_THEMES.find(t => t.id === 'light') ?? BUILT_IN_UI_THEMES[0];
    accent = baseUI.accent;
    tabActive = darkUI.tabActive;
    tabActiveLight = lightUI.tabActive;
    paneBorderActive = darkUI.paneBorderActive;
    paneBorderActiveLight = lightUI.paneBorderActive;
    sidebarActive = baseUI.sidebarActive;
  }

  // Initialize when editor opens
  $: if (isOpen) {
    if (editTerminalTheme) {
      themeName = editTerminalTheme.name;
      foreground = editTerminalTheme.foreground;
      background = editTerminalTheme.background;
      cursor = editTerminalTheme.cursor;
      selectionBackground = editTerminalTheme.selectionBackground;
      fontSize = editTerminalTheme.fontSize ?? 14;
      fontFamily = editTerminalTheme.fontFamily ?? 'Menlo';
      accent = editUITheme?.accent ?? '';
      tabActive = editUITheme?.tabActive ?? editUITheme?.accent ?? '';
      tabActiveLight = editUITheme?.tabActiveLight ?? (BUILT_IN_UI_THEMES.find(t => t.id === 'light') ?? BUILT_IN_UI_THEMES[0]).tabActive;
      paneBorderActive = editUITheme?.paneBorderActive ?? editUITheme?.accent ?? '';
      paneBorderActiveLight = editUITheme?.paneBorderActiveLight ?? (BUILT_IN_UI_THEMES.find(t => t.id === 'light') ?? BUILT_IN_UI_THEMES[0]).paneBorderActive;
      sidebarActive = editUITheme?.sidebarActive ?? editUITheme?.accent ?? '';
    } else if (copySourceTerminal) {
      themeName = copySourceTerminal.name + ' Copy';
      foreground = copySourceTerminal.foreground;
      background = copySourceTerminal.background;
      cursor = copySourceTerminal.cursor;
      selectionBackground = copySourceTerminal.selectionBackground;
      fontSize = copySourceTerminal.fontSize ?? 14;
      fontFamily = copySourceTerminal.fontFamily ?? 'Menlo';
      accent = copySourceUI?.accent ?? '';
      tabActive = copySourceUI?.tabActive ?? copySourceUI?.accent ?? '';
      tabActiveLight = copySourceUI?.tabActiveLight ?? (BUILT_IN_UI_THEMES.find(t => t.id === 'light') ?? BUILT_IN_UI_THEMES[0]).tabActive;
      paneBorderActive = copySourceUI?.paneBorderActive ?? copySourceUI?.accent ?? '';
      paneBorderActiveLight = copySourceUI?.paneBorderActiveLight ?? (BUILT_IN_UI_THEMES.find(t => t.id === 'light') ?? BUILT_IN_UI_THEMES[0]).paneBorderActive;
      sidebarActive = copySourceUI?.sidebarActive ?? copySourceUI?.accent ?? '';
    } else {
      if (initialBaseThemeId) {
        baseThemeId = initialBaseThemeId;
      }
      initFromBase();
    }
  }

  // When base theme changes while editor is open, re-initialize
  function handleBaseThemeChange(event: Event) {
    const target = event.target as HTMLSelectElement;
    baseThemeId = target.value;
    initFromBase();
  }

  function darkenHex(hex: string, amount = 20): string {
    const h = hex.replace('#', '');
    const r = Math.max(0, parseInt(h.substring(0, 2), 16) - amount);
    const g = Math.max(0, parseInt(h.substring(2, 4), 16) - amount);
    const b = Math.max(0, parseInt(h.substring(4, 6), 16) - amount);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
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

    if (isEditMode && isBuiltInEdit && editUITheme && editTerminalTheme) {
      // Override built-in theme — save with same IDs
      // Use terminal theme's ID for UI override to avoid cross-contamination
      // (e.g., editing dark-green shouldn't affect the dark UI theme)
      const uiOverrideId = editTerminalTheme.id;

      const updatedUI: UITheme = {
        ...editUITheme,
        id: uiOverrideId,
        name: themeName.trim(),
        accent,
        accentHover: darkenHex(accent),
        tabActive,
        tabActiveLight,
        paneBorderActive,
        paneBorderActiveLight,
        sidebarActive,
      };

      const updatedTerm: TerminalTheme = {
        ...editTerminalTheme,
        name: themeName.trim(),
        foreground,
        background,
        cursor,
        cursorAccent: background,
        selectionBackground,
        fontSize,
        fontFamily,
      };

      upsertCustomUITheme(updatedUI);
      upsertCustomTerminalTheme(updatedTerm);
    } else if (isEditMode && !isBuiltInEdit && editUITheme && editTerminalTheme) {
      // Update existing custom theme
      const updatedUI: UITheme = {
        ...editUITheme,
        name: themeName.trim(),
        accent,
        accentHover: darkenHex(accent),
        tabActive,
        tabActiveLight,
        paneBorderActive,
        paneBorderActiveLight,
        sidebarActive,
      };

      const updatedTerm: TerminalTheme = {
        ...editTerminalTheme,
        name: themeName.trim(),
        foreground,
        background,
        cursor,
        cursorAccent: background,
        selectionBackground,
        fontSize,
        fontFamily,
      };

      updateCustomUITheme(editUITheme.id, updatedUI);
      updateCustomTerminalTheme(editTerminalTheme.id, updatedTerm);
    } else {
      // Create new custom theme (from base or copy)
      const baseUI = copySourceUI ?? (BUILT_IN_UI_THEMES.find(t => t.id === baseThemeId) ?? BUILT_IN_UI_THEMES[0]);
      const baseTerm = copySourceTerminal ?? (BUILT_IN_TERMINAL_THEMES.find(t => t.id === baseThemeId) ?? BUILT_IN_TERMINAL_THEMES[0]);

      const customUI: UITheme = {
        ...baseUI,
        id: generateId(),
        name: themeName.trim(),
        accent,
        accentHover: darkenHex(accent),
        tabActive,
        tabActiveLight,
        paneBorderActive,
        paneBorderActiveLight,
        sidebarActive,
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
        fontSize,
        fontFamily,
        ansi: { ...baseTerm.ansi },
      };

      addCustomUITheme(customUI);
      addCustomTerminalTheme(customTerm);
      setActiveUITheme(customUI.id);
      setActiveTerminalTheme(customTerm.id);
    }

    themeName = '';
    baseThemeId = 'dark';
    dispatch('save');
  }

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) {
      handleCancel();
    }
  }

  // Font handlers — update local per-theme state (saved into the custom theme on Save)
  function handleFontSizeChange(event: Event) {
    const target = event.target as HTMLInputElement;
    fontSize = parseInt(target.value, 10);
  }

  function handleFontFamilyChange(event: Event) {
    const target = event.target as HTMLSelectElement;
    fontFamily = target.value;
  }

  // Cursor handlers — update settingsStore directly (global, not per-theme)
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

  function handleAccentChange(event: CustomEvent<string>) {
    accent = event.detail;
  }

  function handleTabActiveChange(event: CustomEvent<string>) {
    tabActive = event.detail;
  }

  function handleTabActiveLightChange(event: CustomEvent<string>) {
    tabActiveLight = event.detail;
  }

  function handlePaneBorderActiveChange(event: CustomEvent<string>) {
    paneBorderActive = event.detail;
  }

  function handlePaneBorderActiveLightChange(event: CustomEvent<string>) {
    paneBorderActiveLight = event.detail;
  }

  function handleSidebarActiveChange(event: CustomEvent<string>) {
    sidebarActive = event.detail;
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
        <h2>{headerText}</h2>
      </div>

      <div class="panel-content">
        <div class="columns">
          <div class="column">
            <div class="field">
              <label for="themeName">Theme Name</label>
              <input
                id="themeName"
                type="text"
                bind:value={themeName}
                placeholder="My Custom Theme"
                readonly={isBuiltInEdit}
              />
            </div>

            {#if !isEditMode && !isCopyMode}
              <div class="field">
                <label for="baseTheme">Base Theme</label>
                <select id="baseTheme" value={baseThemeId} on:change={handleBaseThemeChange}>
                  {#each BUILT_IN_UI_THEMES as theme}
                    <option value={theme.id}>{theme.name}</option>
                  {/each}
                </select>
              </div>
            {/if}

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
              <label for="themeEditorFontFamily">Font Family</label>
              <select
                id="themeEditorFontFamily"
                value={fontFamily}
                on:change={handleFontFamilyChange}
              >
                {#each FONT_FAMILIES as font}
                  <option value={font}>{font}</option>
                {/each}
              </select>
            </div>

            <div class="field">
              <label for="themeEditorFontSize">
                Font Size: <span class="value">{fontSize}px</span>
              </label>
              <input
                type="range"
                id="themeEditorFontSize"
                min="10"
                max="24"
                step="1"
                value={fontSize}
                on:input={handleFontSizeChange}
              />
            </div>

            <div class="field">
              <label for="themeEditorCursorStyle">Cursor Style</label>
              <select
                id="themeEditorCursorStyle"
                value={cursorStyle}
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
                  checked={cursorBlink}
                  on:change={handleCursorBlinkChange}
                />
                <span class="slider"></span>
              </label>
            </div>
          </div>

          <div class="column">
            <div class="section-label">UI Colors</div>

            <div class="field">
              <ColorPicker
                id="themeEditorAccent"
                label="Accent Color"
                value={accent}
                on:change={handleAccentChange}
              />
            </div>

            <div class="field">
              <ColorPicker
                id="themeEditorTabActive"
                label="Active Tab (Dark)"
                value={tabActive}
                showOpacity={true}
                on:change={handleTabActiveChange}
              />
            </div>

            <div class="field">
              <ColorPicker
                id="themeEditorTabActiveLight"
                label="Active Tab (Light)"
                value={tabActiveLight}
                showOpacity={true}
                on:change={handleTabActiveLightChange}
              />
            </div>

            <div class="field">
              <ColorPicker
                id="themeEditorPaneBorderActive"
                label="Active Pane Border (Dark)"
                value={paneBorderActive}
                showOpacity={true}
                on:change={handlePaneBorderActiveChange}
              />
            </div>

            <div class="field">
              <ColorPicker
                id="themeEditorPaneBorderActiveLight"
                label="Active Pane Border (Light)"
                value={paneBorderActiveLight}
                showOpacity={true}
                on:change={handlePaneBorderActiveLightChange}
              />
            </div>

            <div class="field">
              <ColorPicker
                id="themeEditorSidebarActive"
                label="Sidebar Active Highlight"
                value={sidebarActive}
                showOpacity={true}
                on:change={handleSidebarActiveChange}
              />
            </div>

          </div>
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
    zoom: var(--controls-zoom, 1);
    background: var(--ui-bg-secondary, #181a1c);
    border: 1px solid var(--ui-border, #47484a);
    border-radius: 8px;
    width: 720px;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  }

  .panel-header {
    padding: 16px 20px;
    border-bottom: 1px solid var(--ui-border, #47484a);
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
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  }

  .columns {
    display: flex;
    gap: 24px;
  }

  .column {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .section-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--ui-text-primary, #e0e0e0);
    border-bottom: 1px solid var(--ui-border, #47484a);
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
    color: var(--ui-text-secondary, #ababad);
    font-weight: 500;
  }

  .field .value {
    color: var(--ui-text-primary, #fdfbfe);
    font-weight: 400;
    margin-left: 4px;
  }

  .field input[type="text"],
  .field select {
    padding: 8px 12px;
    background: var(--ui-bg-tertiary, #242629);
    border: 1px solid var(--ui-border, #555);
    border-radius: 4px;
    color: var(--ui-text-primary, white);
    font-size: 13px;
  }

  .field input[type="text"]:focus,
  .field select:focus {
    outline: none;
    border-color: var(--ui-accent, #a0a7ff);
  }

  .field input[type="range"] {
    width: 100%;
    height: 4px;
    -webkit-appearance: none;
    appearance: none;
    background: var(--ui-bg-tertiary, #242629);
    border-radius: 2px;
    outline: none;
  }

  .field input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 16px;
    height: 16px;
    background: var(--ui-accent, #a0a7ff);
    border-radius: 50%;
    cursor: pointer;
    transition: background 0.15s;
  }

  .field input[type="range"]::-webkit-slider-thumb:hover {
    background: var(--ui-accent-hover, #8f97ff);
  }

  .field input[type="range"]::-moz-range-thumb {
    width: 16px;
    height: 16px;
    background: var(--ui-accent, #a0a7ff);
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
    background-color: var(--ui-bg-tertiary, #242629);
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
    background-color: var(--ui-accent, #a0a7ff);
  }

  .toggle input:checked + .slider:before {
    transform: translateX(20px);
  }

  .panel-footer {
    padding: 16px 20px;
    border-top: 1px solid var(--ui-border, #47484a);
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    flex-shrink: 0;
  }

  .btn-cancel {
    padding: 8px 16px;
    background: var(--ui-bg-tertiary, #242629);
    border: 1px solid var(--ui-border, #555);
    border-radius: 4px;
    color: var(--ui-text-primary, #fdfbfe);
    font-size: 13px;
    cursor: pointer;
  }

  .btn-cancel:hover {
    background: var(--ui-bg-hover, #4a4a4a);
  }

  .btn-save {
    padding: 8px 16px;
    background: var(--ui-accent, #a0a7ff);
    border: none;
    border-radius: 4px;
    color: white;
    font-size: 13px;
    cursor: pointer;
  }

  .btn-save:hover {
    background: var(--ui-accent-hover, #8f97ff);
  }

  .btn-save:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
