<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import ThemeEditor from './ThemeEditor.svelte';
  import {
    addCustomUITheme,
    addCustomTerminalTheme,
    deleteCustomUITheme,
    deleteCustomTerminalTheme,
    getActiveUITheme,
    getActiveTerminalTheme,
    isBuiltInOverridden,
    resetBuiltInOverride,
  } from '../lib/themeStore.svelte';
  import type { UITheme, TerminalTheme } from '../lib/themeTypes';
  import { exportTheme, importTheme, type ExportedTheme } from '../lib/themeExport';
  import {
    settingsStore,
    DEFAULT_SETTINGS,
    TITLE_BAR_FIELD_LABELS,
    type TerminalSettings,
    type TitleBarFieldEntry,
  } from '../lib/settingsStore.svelte';
  import {
    themeState,
    setActiveTerminalTheme,
    setUIMode,
    type UIMode,
  } from '../lib/themeStore.svelte';
  import { BUILT_IN_TERMINAL_THEMES, BUILT_IN_UI_THEMES, BUILT_IN_TERMINAL_THEME_IDS } from '../lib/themeTypes';
  import EnvVarsModal from './EnvVarsModal.svelte';
  import { getKeyBindingRegistry, formatBinding, type KeyBinding } from '../lib/keybindings';
  import { tagStore } from '../lib/tagStore.svelte';
  import TagEditorModal from './TagEditorModal.svelte';

  let { isOpen = false, onclose }: {
    isOpen?: boolean;
    onclose?: () => void;
  } = $props();

  let panelElement = $state<HTMLDivElement>();

  // Subscribe to settings store
  let settings: TerminalSettings = $state(DEFAULT_SETTINGS);
  const unsubscribe = settingsStore.subscribe((value) => {
    settings = value;
  });

  function contrastColor(hex: string): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 > 128 ? '#000' : '#fff';
  }

  function handleClose() {
    onclose?.();
  }

  function handleKeydown(event: KeyboardEvent) {
    if (recordingAction) {
      handleKeybindingCapture(event);
      return;
    }
    if (event.key === 'Escape') {
      handleClose();
    }
  }

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) {
      handleClose();
    }
  }

  function handleTerminalZoomChange(event: Event) {
    const target = event.target as HTMLInputElement;
    settingsStore.updateSetting('terminalZoom', parseFloat(target.value));
  }

  function handleControlsZoomChange(event: Event) {
    const target = event.target as HTMLInputElement;
    settingsStore.updateSetting('controlsZoom', parseFloat(target.value));
  }

  function handlePaneTitleBarsChange(event: Event) {
    const target = event.target as HTMLInputElement;
    settingsStore.updateSetting('showPaneTitleBars', target.checked);
  }

  // Title bar field drag-and-drop reordering
  let dragFieldIndex: number | null = $state(null);
  let dragOverFieldIndex: number | null = $state(null);

  function handleFieldDragStart(event: DragEvent, index: number) {
    dragFieldIndex = index;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(index));
    }
  }

  function handleFieldDragOver(event: DragEvent, index: number) {
    if (dragFieldIndex === null) return;
    event.preventDefault();
    dragOverFieldIndex = index;
  }

  function handleFieldDrop(event: DragEvent, toIndex: number) {
    event.preventDefault();
    if (dragFieldIndex === null || dragFieldIndex === toIndex) {
      dragFieldIndex = null;
      dragOverFieldIndex = null;
      return;
    }
    const fields = [...(settings.titleBarFields ?? [])];
    const [moved] = fields.splice(dragFieldIndex, 1);
    fields.splice(toIndex, 0, moved);
    settingsStore.updateSetting('titleBarFields', fields);
    dragFieldIndex = null;
    dragOverFieldIndex = null;
  }

  function handleFieldDragEnd() {
    dragFieldIndex = null;
    dragOverFieldIndex = null;
  }

  function handleFieldToggle(index: number) {
    const fields = [...(settings.titleBarFields ?? [])];
    fields[index] = { ...fields[index], visible: !fields[index].visible };
    settingsStore.updateSetting('titleBarFields', fields);
  }

  function handleDimInactivePanesChange(event: Event) {
    const target = event.target as HTMLInputElement;
    settingsStore.updateSetting('dimInactivePanes', parseFloat(target.value));
  }

  function handleAutoScrollChange(event: Event) {
    const target = event.target as HTMLInputElement;
    settingsStore.updateSetting('autoScroll', target.checked);
  }

  function handleDefaultCwdChange(event: Event) {
    const target = event.target as HTMLInputElement;
    settingsStore.updateSetting('defaultCwd', target.value.trim());
  }

  // Line height disabled - breaks TUI apps

  // All available UI and terminal themes (built-in + custom)
  let allTerminalThemes = $derived((() => {
    const customById = new Map(themeState.value.customTerminalThemes.map(t => [t.id, t]));
    const merged = BUILT_IN_TERMINAL_THEMES.map(t => customById.get(t.id) ?? t);
    const nonOverrides = themeState.value.customTerminalThemes.filter(
      t => !BUILT_IN_TERMINAL_THEME_IDS.has(t.id)
    );
    return [...merged, ...nonOverrides];
  })());

  function handleUIModeChange(event: Event) {
    const target = event.target as HTMLSelectElement;
    setUIMode(target.value as UIMode);
  }

  function handleTerminalThemeChange(event: Event) {
    const target = event.target as HTMLSelectElement;
    setActiveTerminalTheme(target.value);
  }

  let showThemeEditor = $state(false);
  let editUITheme: UITheme | null = $state(null);
  let editTerminalTheme: TerminalTheme | null = $state(null);
  let editBaseThemeId: string | null = $state(null);
  let copySourceUI: UITheme | null = $state(null);
  let copySourceTerminal: TerminalTheme | null = $state(null);

  interface GroupedCustomTheme {
    name: string;
    uiTheme: UITheme;
    terminalTheme: TerminalTheme;
  }

  let groupedCustomThemes = $derived((() => {
    const groups: GroupedCustomTheme[] = [];
    for (const ui of themeState.value.customUIThemes) {
      if (BUILT_IN_TERMINAL_THEME_IDS.has(ui.id)) continue;
      const term = themeState.value.customTerminalThemes.find(t => t.name === ui.name);
      if (term && !BUILT_IN_TERMINAL_THEME_IDS.has(term.id)) {
        groups.push({ name: ui.name, uiTheme: ui, terminalTheme: term });
      }
    }
    return groups;
  })());

  // Custom themes that don't have a matching pair (orphaned), excluding built-in overrides
  let orphanedUIThemes = $derived(themeState.value.customUIThemes.filter(
    ui => !BUILT_IN_TERMINAL_THEME_IDS.has(ui.id) && !themeState.value.customTerminalThemes.some(t => t.name === ui.name)
  ));
  let orphanedTerminalThemes = $derived(themeState.value.customTerminalThemes.filter(
    t => !BUILT_IN_TERMINAL_THEME_IDS.has(t.id) && !themeState.value.customUIThemes.some(ui => ui.name === t.name)
  ));

  function handleCreateTheme() {
    editUITheme = null;
    editTerminalTheme = null;
    editBaseThemeId = null;
    copySourceUI = null;
    copySourceTerminal = null;
    showThemeEditor = true;
  }

  function handleEditTheme(uiTheme: UITheme, terminalTheme: TerminalTheme) {
    editUITheme = uiTheme;
    editTerminalTheme = terminalTheme;
    editBaseThemeId = null;
    copySourceUI = null;
    copySourceTerminal = null;
    showThemeEditor = true;
  }

  function handleCopyTheme(uiTheme: UITheme, terminalTheme: TerminalTheme) {
    editUITheme = null;
    editTerminalTheme = null;
    editBaseThemeId = null;
    copySourceUI = uiTheme;
    copySourceTerminal = terminalTheme;
    showThemeEditor = true;
  }

  function handleThemeEditorClose() {
    showThemeEditor = false;
    editUITheme = null;
    editTerminalTheme = null;
    editBaseThemeId = null;
    copySourceUI = null;
    copySourceTerminal = null;
  }

  function handleThemeEditorSave() {
    showThemeEditor = false;
    editUITheme = null;
    editTerminalTheme = null;
    editBaseThemeId = null;
    copySourceUI = null;
    copySourceTerminal = null;
  }

  function handleExportTheme() {
    const ui = getActiveUITheme();
    const terminal = getActiveTerminalTheme();
    const exported = exportTheme({ ui, terminal });
    const json = JSON.stringify(exported, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${exported.name.toLowerCase().replace(/\s+/g, '-')}-theme.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImportTheme() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data: ExportedTheme = JSON.parse(text);
        const result = importTheme(data);
        if (result.ui) addCustomUITheme(result.ui);
        if (result.terminal) addCustomTerminalTheme(result.terminal);
      } catch (e) {
        console.error('[Settings] Failed to import theme:', e);
      }
    };
    input.click();
  }

  function handleDeleteUITheme(id: string) {
    deleteCustomUITheme(id);
  }

  function handleDeleteTerminalTheme(id: string) {
    deleteCustomTerminalTheme(id);
  }

  // Environment variables modal
  let showEnvModal = $state(false);

  // Keyboard shortcuts
  let recordingAction: string | null = $state(null);

  function getEffectiveBindings() {
    return getKeyBindingRegistry().getEffectiveBindings();
  }

  let effectiveBindings = $state(getEffectiveBindings());

  function refreshBindings() {
    effectiveBindings = getEffectiveBindings();
  }

  function startRecording(action: string) {
    recordingAction = action;
  }

  function handleKeybindingCapture(event: KeyboardEvent) {
    if (!recordingAction) return;
    if (event.key === 'Escape') {
      recordingAction = null;
      return;
    }
    // Ignore bare modifier keys
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return;

    event.preventDefault();
    event.stopPropagation();

    const registry = getKeyBindingRegistry();
    registry.setOverride(recordingAction, {
      key: event.key,
      ctrl: event.ctrlKey,
      shift: event.shiftKey,
      alt: event.altKey,
      meta: event.metaKey,
    });
    recordingAction = null;
    refreshBindings();
  }

  function handleClearOverride(action: string) {
    const registry = getKeyBindingRegistry();
    registry.clearOverride(action);
    refreshBindings();
  }

  let showTagEditor = $state(false);

  function handleReset() {
    settingsStore.reset();
  }

  onMount(() => {
    document.addEventListener('keydown', handleKeydown);
  });

  onDestroy(() => {
    document.removeEventListener('keydown', handleKeydown);
    unsubscribe();
  });
</script>

{#if isOpen}
  <div class="modal-backdrop" onmousedown={handleBackdropClick} role="dialog" aria-modal="true">
    <div class="settings-panel" bind:this={panelElement}>
      <div class="panel-header">
        <h2>Terminal Settings</h2>
        <button class="close-btn" onclick={handleClose} aria-label="Close settings">
          <span aria-hidden="true">&times;</span>
        </button>
      </div>

      <div class="panel-content">
        <div class="columns">
          <!-- Left column: Appearance & Terminal -->
          <div class="column">
            <!-- Mode (Light / Dark / Auto) -->
            <div class="setting-group">
              <label for="uiMode">Mode</label>
              <select
                id="uiMode"
                value={themeState.value.uiMode}
                onchange={handleUIModeChange}
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
                <option value="auto">Auto</option>
              </select>
            </div>

            <!-- Terminal Theme -->
            <div class="setting-group">
              <label for="terminalTheme">Terminal Theme</label>
              <select
                id="terminalTheme"
                value={themeState.value.activeTerminalThemeId}
                onchange={handleTerminalThemeChange}
              >
                {#each allTerminalThemes as theme}
                  <option value={theme.id}>{theme.name}</option>
                {/each}
              </select>
            </div>

            <!-- Theme Actions -->
            <div class="theme-actions">
              <button class="theme-action-btn" onclick={handleCreateTheme}>Create Theme</button>
              <button class="theme-action-btn" onclick={handleExportTheme}>Export</button>
              <button class="theme-action-btn" onclick={handleImportTheme}>Import</button>
            </div>

            <!-- All Themes (built-in + custom) -->
            <div class="setting-group">
              <label>Themes</label>
              <div class="custom-theme-list">
                {#each BUILT_IN_TERMINAL_THEMES as builtInTheme}
                  {@const overridden = import.meta.env.DEV && isBuiltInOverridden(builtInTheme.id)}
                  {@const displayTerm = overridden
                    ? themeState.value.customTerminalThemes.find(t => t.id === builtInTheme.id) ?? builtInTheme
                    : builtInTheme}
                  {@const builtInUI = BUILT_IN_UI_THEMES.find(u => u.id === builtInTheme.id) ?? BUILT_IN_UI_THEMES[0]}
                  {@const displayUI = (overridden
                    ? themeState.value.customUIThemes.find(u => u.id === builtInTheme.id)
                    : null) ?? builtInUI}
                  <div class="custom-theme-item">
                    <span>
                      {displayTerm.name}
                      {#if import.meta.env.DEV && overridden}
                        <span class="modified-badge">(modified)</span>
                      {:else if !import.meta.env.DEV}
                        <span class="system-badge">system</span>
                      {/if}
                    </span>
                    <div class="custom-theme-actions">
                      {#if import.meta.env.DEV}
                        <button class="edit-theme-btn" onclick={() => handleEditTheme(displayUI, displayTerm)}>Edit</button>
                        <button class="edit-theme-btn" onclick={() => handleCopyTheme(displayUI, displayTerm)}>Copy</button>
                        {#if overridden}
                          <button class="edit-theme-btn" onclick={() => resetBuiltInOverride(builtInTheme.id)}>Reset</button>
                        {/if}
                      {:else}
                        <button class="edit-theme-btn" onclick={() => handleCopyTheme(displayUI, displayTerm)}>Duplicate</button>
                      {/if}
                    </div>
                  </div>
                {/each}
                {#each groupedCustomThemes as group}
                  <div class="custom-theme-item">
                    <span>{group.name}</span>
                    <div class="custom-theme-actions">
                      <button class="edit-theme-btn" onclick={() => handleEditTheme(group.uiTheme, group.terminalTheme)}>Edit</button>
                      <button class="edit-theme-btn" onclick={() => handleCopyTheme(group.uiTheme, group.terminalTheme)}>Copy</button>
                      <button class="delete-theme-btn" onclick={() => { handleDeleteUITheme(group.uiTheme.id); handleDeleteTerminalTheme(group.terminalTheme.id); }}>×</button>
                    </div>
                  </div>
                {/each}
                {#each orphanedUIThemes as theme}
                  <div class="custom-theme-item">
                    <span>{theme.name} (UI)</span>
                    <div class="custom-theme-actions">
                      <button class="delete-theme-btn" onclick={() => handleDeleteUITheme(theme.id)}>×</button>
                    </div>
                  </div>
                {/each}
                {#each orphanedTerminalThemes as theme}
                  <div class="custom-theme-item">
                    <span>{theme.name} (Terminal)</span>
                    <div class="custom-theme-actions">
                      <button class="delete-theme-btn" onclick={() => handleDeleteTerminalTheme(theme.id)}>×</button>
                    </div>
                  </div>
                {/each}
              </div>
            </div>

            <!-- Terminal Zoom -->
            <div class="setting-group">
              <label for="terminalZoom">Terminal Zoom ({Math.round((settings.terminalZoom ?? 1) * 100)}%)</label>
              <input
                type="range"
                id="terminalZoom"
                min="0.5"
                max="2"
                step="0.05"
                value={settings.terminalZoom ?? 1}
                oninput={handleTerminalZoomChange}
                ondblclick={() => settingsStore.updateSetting('terminalZoom', 1)}
              />
            </div>

            <!-- Controls Zoom -->
            <div class="setting-group">
              <label for="controlsZoom">Controls Zoom ({Math.round((settings.controlsZoom ?? 1) * 100)}%)</label>
              <input
                type="range"
                id="controlsZoom"
                min="0.5"
                max="2"
                step="0.05"
                value={settings.controlsZoom ?? 1}
                oninput={handleControlsZoomChange}
                ondblclick={() => settingsStore.updateSetting('controlsZoom', 1)}
              />
            </div>

            <!-- Default Folder -->
            <div class="setting-group">
              <label for="defaultCwd">Default Folder for New Terminals</label>
              <input
                type="text"
                id="defaultCwd"
                class="text-input"
                data-testid="default-cwd"
                placeholder="e.g. ~/code or /Users/you/projects"
                value={settings.defaultCwd ?? ''}
                onchange={handleDefaultCwdChange}
              />
              <span class="field-hint">Leave empty to use $HOME. Split panes and "New Terminal in Pane" still inherit the current folder.</span>
            </div>

            <!-- Environment Variables -->
            <div class="setting-group" data-testid="env-vars-section">
              <label>Environment Variables</label>
              <button class="env-button" onclick={() => showEnvModal = true}>
                Environment Variables
              </button>
              <span class="field-hint">Set environment variables for terminal sessions</span>
            </div>
          </div>

          <!-- Right column: Panes & Shortcuts -->
          <div class="column">
            <!-- Dim Inactive Panes -->
            <div class="setting-group">
              <label for="dimInactivePanes">Dim Inactive Panes {settings.dimInactivePanes >= 1 ? '(off)' : `(${Math.round(settings.dimInactivePanes * 100)}%)`}</label>
              <input
                type="range"
                id="dimInactivePanes"
                min="0.1"
                max="1"
                step="0.1"
                value={settings.dimInactivePanes}
                oninput={handleDimInactivePanesChange}
              />
            </div>

            <!-- Auto-Scroll -->
            <div class="setting-group toggle-group">
              <label for="autoScroll">Auto-Scroll on Output</label>
              <label class="toggle">
                <input
                  type="checkbox"
                  id="autoScroll"
                  checked={settings.autoScroll}
                  onchange={handleAutoScrollChange}
                />
                <span class="slider"></span>
              </label>
            </div>

            <!-- Tags -->
            <div class="setting-group">
              <label>Tags</label>
              <div class="tag-summary">
                {#each tagStore.definitions as def (def.id)}
                  <span class="tag-badge-preview" style="background: {def.color}; color: {def.fontColor || contrastColor(def.color)}">
                    {def.name}
                  </span>
                {/each}
                <button class="theme-action-btn" onclick={() => showTagEditor = true}>
                  {tagStore.definitions.length > 0 ? 'Edit Tags' : 'Add Tags'}
                </button>
              </div>
            </div>

            <!-- Pane Title Bars -->
            <div class="setting-group toggle-group">
              <label for="showPaneTitleBars">Pane Title Bars</label>
              <label class="toggle">
                <input
                  type="checkbox"
                  id="showPaneTitleBars"
                  checked={settings.showPaneTitleBars}
                  onchange={handlePaneTitleBarsChange}
                />
                <span class="slider"></span>
              </label>
            </div>

            <!-- Title Bar Fields (drag to reorder, toggle visibility) -->
            {#if settings.showPaneTitleBars && settings.titleBarFields}
              <div class="setting-group">
                <label>Title Bar Fields</label>
                <div class="field-order-list">
                  {#each settings.titleBarFields as field, index (field.id)}
                    <div
                      class="field-order-item"
                      class:drag-over={dragOverFieldIndex === index}
                      class:dragging={dragFieldIndex === index}
                      draggable="true"
                      ondragstart={(e) => handleFieldDragStart(e, index)}
                      ondragover={(e) => handleFieldDragOver(e, index)}
                      ondragleave={() => { if (dragOverFieldIndex === index) dragOverFieldIndex = null; }}
                      ondrop={(e) => handleFieldDrop(e, index)}
                      ondragend={handleFieldDragEnd}
                      role="listitem"
                    >
                      <span class="drag-handle">⠿</span>
                      <label class="field-toggle">
                        <input
                          type="checkbox"
                          checked={field.visible}
                          onchange={() => handleFieldToggle(index)}
                        />
                        <span>{TITLE_BAR_FIELD_LABELS[field.id]}</span>
                      </label>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}

            <!-- Keyboard Shortcuts -->
            <div class="setting-group">
              <label>Keyboard Shortcuts</label>
              <div class="keybinding-list">
                {#each effectiveBindings as { action, label, bindings, isOverridden }}
                  <div class="keybinding-row">
                    <span class="keybinding-action">{label}</span>
                    <div class="keybinding-keys">
                      {#if recordingAction === action}
                        <span class="keybinding-badge recording">Press keys...</span>
                      {:else}
                        {#each bindings as binding}
                          <button class="keybinding-badge" onclick={() => startRecording(action)}>
                            {formatBinding(binding)}
                          </button>
                        {/each}
                      {/if}
                      {#if isOverridden}
                        <button class="keybinding-reset" onclick={() => handleClearOverride(action)} title="Reset to default">
                          &#8617;
                        </button>
                      {/if}
                    </div>
                  </div>
                {/each}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="panel-footer">
        <button class="reset-btn" onclick={handleReset}>Reset to Defaults</button>
      </div>
    </div>
  </div>
{/if}

<ThemeEditor isOpen={showThemeEditor} {editUITheme} {editTerminalTheme} initialBaseThemeId={editBaseThemeId} {copySourceUI} {copySourceTerminal} on:close={handleThemeEditorClose} on:save={handleThemeEditorSave} />
<TagEditorModal isOpen={showTagEditor} onclose={() => showTagEditor = false} />

{#if showEnvModal}
  <EnvVarsModal onClose={() => showEnvModal = false} />
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
    z-index: 1000;
  }

  .settings-panel {
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
    display: flex;
    align-items: center;
    justify-content: space-between;
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

  .close-btn {
    background: none;
    border: none;
    color: var(--ui-text-secondary, #ababad);
    font-size: 24px;
    line-height: 1;
    cursor: pointer;
    padding: 0;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
  }

  .close-btn:hover {
    background: var(--ui-bg-tertiary, #242629);
    color: var(--ui-text-primary, #fdfbfe);
  }

  .panel-content {
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 20px;
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
    gap: 20px;
    min-width: 0;
  }

  .setting-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .setting-group label {
    font-size: 12px;
    color: var(--ui-text-secondary, #ababad);
    font-weight: 500;
  }

  .setting-group select {
    padding: 8px 12px;
    background: var(--ui-bg-tertiary, #242629);
    border: 1px solid var(--ui-border, #555);
    border-radius: 4px;
    color: var(--ui-text-primary, white);
    font-size: 13px;
    cursor: pointer;
  }

  .setting-group select:focus {
    outline: none;
    border-color: var(--ui-accent, #a0a7ff);
  }

  .setting-group input[type="range"] {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 6px;
    background: var(--ui-bg-tertiary, #242629);
    border-radius: 3px;
    outline: none;
    cursor: pointer;
  }

  .setting-group input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 16px;
    height: 16px;
    background: var(--ui-accent, #a0a7ff);
    border-radius: 50%;
    cursor: pointer;
  }

  .toggle-group {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }

  .field-order-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-top: 4px;
  }

  .field-order-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    background: var(--ui-bg-tertiary, #242629);
    border-radius: 4px;
    border: 1px solid transparent;
    cursor: grab;
    transition: background 0.1s, border-color 0.1s;
  }

  .field-order-item:active {
    cursor: grabbing;
  }

  .field-order-item.dragging {
    opacity: 0.4;
  }

  .field-order-item.drag-over {
    border-color: var(--ui-accent, #a0a7ff);
  }

  .drag-handle {
    color: var(--ui-text-muted, #666);
    font-size: 12px;
    user-select: none;
    flex-shrink: 0;
  }

  .field-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--ui-text-primary, #fdfbfe);
    cursor: pointer;
    flex: 1;
  }

  .field-toggle input[type="checkbox"] {
    accent-color: var(--ui-accent, #a0a7ff);
    width: 14px;
    height: 14px;
    cursor: pointer;
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
    flex-shrink: 0;
  }

  .reset-btn {
    padding: 8px 16px;
    background: var(--ui-bg-tertiary, #242629);
    border: 1px solid var(--ui-border, #555);
    border-radius: 4px;
    color: var(--ui-text-primary, #fdfbfe);
    font-size: 13px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .reset-btn:hover {
    background: var(--ui-bg-hover, #4a4a4a);
    color: var(--ui-text-primary, white);
  }

  .theme-actions {
    display: flex;
    gap: 8px;
  }

  .theme-action-btn {
    flex: 1;
    padding: 6px 12px;
    background: var(--ui-bg-tertiary, #242629);
    border: 1px solid var(--ui-border, #555);
    border-radius: 4px;
    color: var(--ui-text-primary, #fdfbfe);
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .theme-action-btn:hover {
    background: var(--ui-bg-hover, #4a4a4a);
  }

  .custom-theme-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .custom-theme-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 8px;
    background: var(--ui-bg-tertiary, #242629);
    border-radius: 4px;
    font-size: 12px;
    color: var(--ui-text-primary, #fdfbfe);
  }

  .custom-theme-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .edit-theme-btn {
    background: none;
    border: none;
    color: var(--ui-text-muted, #757578);
    cursor: pointer;
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 2px;
  }

  .edit-theme-btn:hover {
    color: var(--ui-accent, #a0a7ff);
    background: var(--ui-bg-hover, #4a4a4a);
  }

  .delete-theme-btn {
    background: none;
    border: none;
    color: var(--ui-text-muted, #757578);
    cursor: pointer;
    font-size: 14px;
    padding: 0 4px;
    border-radius: 2px;
  }

  .delete-theme-btn:hover {
    color: var(--ui-destructive, #ff6e84);
    background: var(--ui-destructive-hover, #a70138);
  }

  .modified-badge {
    color: var(--ui-text-muted, #757578);
    font-size: 11px;
    font-style: italic;
  }

  .system-badge {
    color: var(--ui-text-muted, #757578);
    font-size: 10px;
    font-variant: small-caps;
    letter-spacing: 0.04em;
    opacity: 0.7;
  }

  .keybinding-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .keybinding-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 0;
  }

  .keybinding-action {
    font-size: 12px;
    color: var(--ui-text-primary, #fdfbfe);
  }

  .keybinding-keys {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .keybinding-badge {
    padding: 2px 8px;
    background: var(--ui-bg-tertiary, #242629);
    border: 1px solid var(--ui-border, #555);
    border-radius: 4px;
    color: var(--ui-text-primary, #fdfbfe);
    font-size: 11px;
    font-family: monospace;
    cursor: pointer;
    transition: all 0.15s;
  }

  .keybinding-badge:hover {
    background: var(--ui-bg-hover, #4a4a4a);
    border-color: var(--ui-accent, #a0a7ff);
  }

  .keybinding-badge.recording {
    background: var(--ui-accent, #a0a7ff);
    border-color: var(--ui-accent, #a0a7ff);
    color: white;
    animation: pulse 1s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }

  .keybinding-reset {
    background: none;
    border: none;
    color: var(--ui-text-muted, #757578);
    cursor: pointer;
    font-size: 14px;
    padding: 0 4px;
    border-radius: 2px;
  }

  .keybinding-reset:hover {
    color: var(--ui-accent, #a0a7ff);
  }

  .tag-summary {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .tag-badge-preview {
    font-size: 11px;
    padding: 1px 7px;
    border-radius: 3px;
    white-space: nowrap;
  }

  .env-button {
    background: var(--ui-bg-tertiary, #242629);
    color: var(--ui-text-primary, #fdfbfe);
    width: 100%;
    text-align: left;
    border: 1px solid var(--ui-border, #555);
    border-radius: 4px;
    padding: 6px 10px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s;
  }

  .env-button:hover {
    background: var(--ui-bg-hover, #4a4a4a);
    border-color: var(--ui-accent, #a0a7ff);
  }

  .field-hint {
    font-size: 11px;
    color: var(--ui-text-muted, #6c7086);
    margin-top: 2px;
  }

  .text-input {
    width: 100%;
    background: var(--ui-bg-tertiary, #242629);
    color: var(--ui-text-primary, #fdfbfe);
    border: 1px solid var(--ui-border, #555);
    border-radius: 4px;
    padding: 6px 10px;
    font-size: 12px;
    font-family: inherit;
    outline: none;
    transition: border-color 0.15s;
    box-sizing: border-box;
  }

  .text-input:focus {
    border-color: var(--ui-accent, #a0a7ff);
  }
</style>
