<script lang="ts">
  import { validateEnvKey } from '../lib/envStore.svelte';

  /** The current env vars to display/edit */
  let { envVars = {}, label = 'Environment Variables', onchange }: {
    envVars?: Record<string, string>;
    /** Optional label shown above the editor */
    label?: string;
    onchange?: (vars: Record<string, string>) => void;
  } = $props();

  // Internal representation as ordered array of rows
  interface EnvRow {
    id: number;
    key: string;
    value: string;
    error: string | null;
  }

  let nextId = 0;
  let rows: EnvRow[] = $state(initRows(envVars));
  let lastEnvVarsRef: Record<string, string> = envVars;

  function initRows(vars: Record<string, string>): EnvRow[] {
    return Object.entries(vars).map(([key, value]) => ({
      id: nextId++,
      key,
      value,
      error: null,
    }));
  }

  // Re-initialize rows only when the envVars prop reference changes from outside
  $effect(() => {
    if (envVars !== lastEnvVarsRef) {
      lastEnvVarsRef = envVars;
      rows = initRows(envVars);
    }
  });

  function emitChange() {
    const result: Record<string, string> = {};
    for (const row of rows) {
      if (row.key.trim() && !row.error) {
        result[row.key] = row.value;
      }
    }
    onchange?.(result);
  }

  function addRow() {
    rows = [...rows, { id: nextId++, key: '', value: '', error: null }];
  }

  function deleteRow(index: number) {
    rows = rows.filter((_, i) => i !== index);
    emitChange();
  }

  function handleKeyChange(index: number, newKey: string) {
    rows[index].key = newKey;
    rows[index].error = validateEnvKey(newKey);
    rows = rows;
  }

  function handleValueChange(index: number, newValue: string) {
    rows[index].value = newValue;
    rows = rows;
  }

  function handleBlur() {
    emitChange();
  }
</script>

<div class="env-editor">
  <div class="env-header">
    <span class="env-label">{label}</span>
  </div>

  {#if rows.length > 0}
    <div class="env-rows">
      {#each rows as row, index (row.id)}
        <div class="env-row">
          <input
            type="text"
            class="env-input env-key-input"
            data-testid="env-key"
            placeholder="KEY"
            value={row.key}
            oninput={(e) => handleKeyChange(index, (e.target as HTMLInputElement)?.value ?? '')}
            onblur={handleBlur}
          />
          <span class="env-equals">=</span>
          <input
            type="text"
            class="env-input env-value-input"
            data-testid="env-value"
            placeholder="value"
            value={row.value}
            oninput={(e) => handleValueChange(index, (e.target as HTMLInputElement)?.value ?? '')}
            onblur={handleBlur}
          />
          <button
            class="env-delete-btn"
            data-testid="env-delete"
            onclick={() => deleteRow(index)}
            title="Remove variable"
            aria-label="Remove variable"
          >
            &times;
          </button>
        </div>
        {#if row.error}
          <div class="env-error" data-testid="env-error">{row.error}</div>
        {/if}
      {/each}
    </div>
  {:else}
    <div class="env-empty">No environment variables set</div>
  {/if}

  <button class="env-add-btn" onclick={addRow}>Add Variable</button>
</div>

<style>
  .env-editor {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .env-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .env-label {
    font-size: 12px;
    color: var(--ui-text-secondary, #ababad);
    font-weight: 500;
  }

  .env-rows {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .env-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .env-input {
    padding: 6px 8px;
    background: var(--ui-bg-tertiary, #242629);
    border: 1px solid var(--ui-border, #555);
    border-radius: 4px;
    color: var(--ui-text-primary, white);
    font-size: 12px;
    font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
  }

  .env-input:focus {
    outline: none;
    border-color: var(--ui-accent, #a0a7ff);
  }

  .env-key-input {
    flex: 2;
    min-width: 0;
  }

  .env-value-input {
    flex: 3;
    min-width: 0;
  }

  .env-equals {
    color: var(--ui-text-muted, #666);
    font-size: 12px;
    font-family: monospace;
    flex-shrink: 0;
  }

  .env-delete-btn {
    background: none;
    border: none;
    color: var(--ui-text-muted, #757578);
    cursor: pointer;
    font-size: 16px;
    padding: 2px 6px;
    border-radius: 4px;
    flex-shrink: 0;
    line-height: 1;
  }

  .env-delete-btn:hover {
    color: var(--ui-destructive, #ff6e84);
    background: var(--ui-destructive-hover, #a70138);
  }

  .env-error {
    font-size: 11px;
    color: var(--ui-destructive, #ff6e84);
    padding-left: 4px;
    margin-top: -2px;
  }

  .env-empty {
    font-size: 12px;
    color: var(--ui-text-muted, #666);
    font-style: italic;
    padding: 4px 0;
  }

  .env-add-btn {
    align-self: flex-start;
    padding: 4px 12px;
    background: var(--ui-bg-tertiary, #242629);
    border: 1px solid var(--ui-border, #555);
    border-radius: 4px;
    color: var(--ui-text-primary, #fdfbfe);
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .env-add-btn:hover {
    background: var(--ui-bg-hover, #4a4a4a);
  }
</style>
