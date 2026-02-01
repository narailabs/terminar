<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import {
    addCustomUITheme,
    addCustomTerminalTheme,
  } from '../lib/themeStore';
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
          <select id="baseTheme" bind:value={baseThemeId}>
            {#each BUILT_IN_UI_THEMES as theme}
              <option value={theme.id}>{theme.name}</option>
            {/each}
          </select>
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
    overflow-y: auto;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  }

  .panel-header {
    padding: 16px 20px;
    border-bottom: 1px solid var(--ui-border, #3c3c3c);
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

  .field input,
  .field select {
    padding: 8px 12px;
    background: var(--ui-bg-tertiary, #3c3c3c);
    border: 1px solid var(--ui-border, #555);
    border-radius: 4px;
    color: var(--ui-text-primary, white);
    font-size: 13px;
  }

  .field input:focus,
  .field select:focus {
    outline: none;
    border-color: var(--ui-accent, #0e639c);
  }

  .panel-footer {
    padding: 16px 20px;
    border-top: 1px solid var(--ui-border, #3c3c3c);
    display: flex;
    justify-content: flex-end;
    gap: 8px;
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
