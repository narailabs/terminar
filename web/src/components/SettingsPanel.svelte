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
  } from '../lib/themeStore.svelte';
  import type { UITheme, TerminalTheme } from '../lib/themeTypes';
  import { exportTheme, importTheme, type ExportedTheme } from '../lib/themeExport';
  import {
    settingsStore,
    DEFAULT_SETTINGS,
    type TerminalSettings,
  } from '../lib/settingsStore.svelte';
  import {
    themeState,
    setActiveTerminalTheme,
    setUIMode,
    type UIMode,
  } from '../lib/themeStore.svelte';
  import { BUILT_IN_TERMINAL_THEMES } from '../lib/themeTypes';
  import EnvVarEditor from './EnvVarEditor.svelte';
  import { globalEnvVars, addEnvVar, updateEnvVar, deleteEnvVar } from '../lib/envStore.svelte';
  import { getKeyBindingRegistry, formatBinding, type KeyBinding } from '../lib/keybindings';

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

  function handlePaneTitleBarsChange(event: Event) {
    const target = event.target as HTMLInputElement;
    settingsStore.updateSetting('showPaneTitleBars', target.checked);
  }

  function handleAutoScrollChange(event: Event) {
    const target = event.target as HTMLInputElement;
    settingsStore.updateSetting('autoScroll', target.checked);
  }

  // Line height disabled - breaks TUI apps

  // All available UI and terminal themes (built-in + custom)
  let allTerminalThemes = $derived([...BUILT_IN_TERMINAL_THEMES, ...themeState.value.customTerminalThemes]);

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

  interface GroupedCustomTheme {
    name: string;
    uiTheme: UITheme;
    terminalTheme: TerminalTheme;
  }

  let groupedCustomThemes = $derived((() => {
    const groups: GroupedCustomTheme[] = [];
    for (const ui of themeState.value.customUIThemes) {
      const term = themeState.value.customTerminalThemes.find(t => t.name === ui.name);
      if (term) {
        groups.push({ name: ui.name, uiTheme: ui, terminalTheme: term });
      }
    }
    return groups;
  })());

  // Custom themes that don't have a matching pair (orphaned)
  let orphanedUIThemes = $derived(themeState.value.customUIThemes.filter(
    ui => !themeState.value.customTerminalThemes.some(t => t.name === ui.name)
  ));
  let orphanedTerminalThemes = $derived(themeState.value.customTerminalThemes.filter(
    t => !themeState.value.customUIThemes.some(ui => ui.name === t.name)
  ));

  function handleCreateTheme() {
    editUITheme = null;
    editTerminalTheme = null;
    showThemeEditor = true;
  }

  function handleEditTheme(uiTheme: UITheme, terminalTheme: TerminalTheme) {
    editUITheme = uiTheme;
    editTerminalTheme = terminalTheme;
    showThemeEditor = true;
  }

  function handleThemeEditorClose() {
    showThemeEditor = false;
    editUITheme = null;
    editTerminalTheme = null;
  }

  function handleThemeEditorSave() {
    showThemeEditor = false;
    editUITheme = null;
    editTerminalTheme = null;
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

  // Environment variables
  let currentEnvVars = $derived(globalEnvVars.value);

  let envSaveTimer: ReturnType<typeof setTimeout> | null = null;

  function handleEnvChange(newVars: Record<string, string>) {
    // Debounce the save to avoid excessive writes
    if (envSaveTimer) clearTimeout(envSaveTimer);
    envSaveTimer = setTimeout(() => {
      // Diff and apply changes
      const current = globalEnvVars.value;
      // Delete removed keys
      for (const key of Object.keys(current)) {
        if (!(key in newVars)) {
          deleteEnvVar(key);
        }
      }
      // Add/update keys
      for (const [key, value] of Object.entries(newVars)) {
        if (current[key] !== value) {
          if (key in current) {
            updateEnvVar(key, value);
          } else {
            addEnvVar(key, value);
          }
        }
      }
    }, 300);
  }

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

  function handleReset() {
    settingsStore.reset();
  }

  onMount(() => {
    document.addEventListener('keydown', handleKeydown);
  });

  onDestroy(() => {
    document.removeEventListener('keydown', handleKeydown);
    unsubscribe();
    if (envSaveTimer) clearTimeout(envSaveTimer);
  });
</script>

{#if isOpen}
  <div class="modal-backdrop" onclick={handleBackdropClick} role="dialog" aria-modal="true">
    <div class="settings-panel" bind:this={panelElement}>
      <div class="panel-header">
        <h2>Terminal Settings</h2>
        <button class="close-btn" onclick={handleClose} aria-label="Close settings">
          <span aria-hidden="true">&times;</span>
        </button>
      </div>

      <div class="panel-content">
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

        <!-- Custom Themes -->
        {#if groupedCustomThemes.length > 0 || orphanedUIThemes.length > 0 || orphanedTerminalThemes.length > 0}
          <div class="setting-group">
            <label>Custom Themes</label>
            <div class="custom-theme-list">
              {#each groupedCustomThemes as group}
                <div class="custom-theme-item">
                  <span>{group.name}</span>
                  <div class="custom-theme-actions">
                    <button class="edit-theme-btn" onclick={() => handleEditTheme(group.uiTheme, group.terminalTheme)}>Edit</button>
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
        {/if}

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

        <!-- Line Height disabled - breaks TUI apps like vim, Claude Code -->

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

        <!-- Environment Variables -->
        <div class="setting-group" data-testid="env-vars-section">
          <EnvVarEditor
            envVars={currentEnvVars}
            label="Global Environment Variables"
            onchange={handleEnvChange}
          />
        </div>
      </div>

      <div class="panel-footer">
        <button class="reset-btn" onclick={handleReset}>Reset to Defaults</button>
      </div>
    </div>
  </div>
{/if}

<ThemeEditor isOpen={showThemeEditor} {editUITheme} {editTerminalTheme} on:close={handleThemeEditorClose} on:save={handleThemeEditorSave} />

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
    background: var(--ui-bg-secondary, #252526);
    border: 1px solid var(--ui-border, #3c3c3c);
    border-radius: 8px;
    width: 380px;
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
    border-bottom: 1px solid var(--ui-border, #3c3c3c);
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
    color: var(--ui-text-secondary, #999);
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
    background: var(--ui-bg-tertiary, #3c3c3c);
    color: var(--ui-text-primary, #fff);
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

  .setting-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .setting-group label {
    font-size: 12px;
    color: var(--ui-text-secondary, #999);
    font-weight: 500;
  }

  .setting-group select {
    padding: 8px 12px;
    background: var(--ui-bg-tertiary, #3c3c3c);
    border: 1px solid var(--ui-border, #555);
    border-radius: 4px;
    color: var(--ui-text-primary, white);
    font-size: 13px;
    cursor: pointer;
  }

  .setting-group select:focus {
    outline: none;
    border-color: var(--ui-accent, #0e639c);
  }

  .toggle-group {
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
    flex-shrink: 0;
  }

  .reset-btn {
    padding: 8px 16px;
    background: var(--ui-bg-tertiary, #3c3c3c);
    border: 1px solid var(--ui-border, #555);
    border-radius: 4px;
    color: var(--ui-text-primary, #cccccc);
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
    background: var(--ui-bg-tertiary, #3c3c3c);
    border: 1px solid var(--ui-border, #555);
    border-radius: 4px;
    color: var(--ui-text-primary, #ccc);
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
    background: var(--ui-bg-tertiary, #3c3c3c);
    border-radius: 4px;
    font-size: 12px;
    color: var(--ui-text-primary, #ccc);
  }

  .custom-theme-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .edit-theme-btn {
    background: none;
    border: none;
    color: var(--ui-text-muted, #888);
    cursor: pointer;
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 2px;
  }

  .edit-theme-btn:hover {
    color: var(--ui-accent, #0e639c);
    background: var(--ui-bg-hover, #4a4a4a);
  }

  .delete-theme-btn {
    background: none;
    border: none;
    color: var(--ui-text-muted, #888);
    cursor: pointer;
    font-size: 14px;
    padding: 0 4px;
    border-radius: 2px;
  }

  .delete-theme-btn:hover {
    color: var(--ui-destructive, #f48771);
    background: var(--ui-destructive-hover, #5a1d1d);
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
    color: var(--ui-text-primary, #ccc);
  }

  .keybinding-keys {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .keybinding-badge {
    padding: 2px 8px;
    background: var(--ui-bg-tertiary, #3c3c3c);
    border: 1px solid var(--ui-border, #555);
    border-radius: 4px;
    color: var(--ui-text-primary, #ccc);
    font-size: 11px;
    font-family: monospace;
    cursor: pointer;
    transition: all 0.15s;
  }

  .keybinding-badge:hover {
    background: var(--ui-bg-hover, #4a4a4a);
    border-color: var(--ui-accent, #0e639c);
  }

  .keybinding-badge.recording {
    background: var(--ui-accent, #0e639c);
    border-color: var(--ui-accent, #0e639c);
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
    color: var(--ui-text-muted, #888);
    cursor: pointer;
    font-size: 14px;
    padding: 0 4px;
    border-radius: 2px;
  }

  .keybinding-reset:hover {
    color: var(--ui-accent, #0e639c);
  }
</style>
