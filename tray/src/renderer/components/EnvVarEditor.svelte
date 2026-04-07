<script lang="ts">
  import { validateEnvKey } from '../lib/envStore.svelte';

  interface Props {
    vars: Record<string, string>;
    onAdd: (key: string, value: string) => void;
    onUpdate: (key: string, value: string) => void;
    onDelete: (key: string) => void;
    scopeLabel: string;
  }

  let { vars, onAdd, onUpdate, onDelete, scopeLabel }: Props = $props();

  let newKey = $state('');
  let newValue = $state('');
  let keyError = $state<string | null>(null);

  function handleAdd() {
    const trimmedKey = newKey.trim();
    const error = validateEnvKey(trimmedKey);
    if (error) {
      keyError = error;
      return;
    }
    if (trimmedKey in vars) {
      keyError = 'Key already exists';
      return;
    }
    onAdd(trimmedKey, newValue);
    newKey = '';
    newValue = '';
    keyError = null;
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      handleAdd();
    }
  }

  function handleValueChange(key: string, value: string) {
    onUpdate(key, value);
  }
</script>

<div class="editor">
  <div class="editor-header">
    <h3>{scopeLabel}</h3>
  </div>

  {#if Object.keys(vars).length === 0}
    <div class="empty">No environment variables set</div>
  {:else}
    <div class="var-list">
      {#each Object.entries(vars) as [key, value] (key)}
        <div class="var-row">
          <span class="var-key" title={key}>{key}</span>
          <input
            class="var-value"
            type="text"
            value={value}
            onchange={(e) => handleValueChange(key, (e.target as HTMLInputElement).value)}
            placeholder="value"
          />
          <button class="delete-btn" onclick={() => onDelete(key)} title="Delete">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3.5 3.5L10.5 10.5M10.5 3.5L3.5 10.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
      {/each}
    </div>
  {/if}

  <div class="add-row">
    <input
      class="add-key"
      type="text"
      bind:value={newKey}
      onkeydown={handleKeyDown}
      placeholder="KEY"
      class:input-error={keyError !== null}
    />
    <input
      class="add-value"
      type="text"
      bind:value={newValue}
      onkeydown={handleKeyDown}
      placeholder="value"
    />
    <button class="add-btn" onclick={handleAdd} disabled={newKey.trim().length === 0}>
      Add
    </button>
  </div>
  {#if keyError}
    <div class="error-msg">{keyError}</div>
  {/if}
</div>

<style>
  .editor {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    height: 100%;
  }

  .editor-header {
    padding-bottom: 0.5rem;
    border-bottom: 1px solid #242629;
  }

  h3 {
    margin: 0;
    font-size: 0.9rem;
    font-weight: 600;
    color: #fdfbfe;
  }

  .empty {
    color: #6c7086;
    font-size: 0.85rem;
    padding: 1.5rem 0;
    text-align: center;
  }

  .var-list {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  }

  .var-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .var-key {
    font-size: 0.8rem;
    font-family: 'SF Mono', 'Fira Code', monospace;
    color: #a0a7ff;
    min-width: 120px;
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .var-value {
    flex: 1;
    background: #181a1c;
    border: 1px solid #47484a;
    border-radius: 4px;
    color: #fdfbfe;
    padding: 0.3rem 0.5rem;
    font-size: 0.8rem;
    font-family: 'SF Mono', 'Fira Code', monospace;
  }

  .var-value:focus {
    border-color: #a0a7ff;
    outline: none;
  }

  .delete-btn {
    background: none;
    border: none;
    color: #6c7086;
    cursor: pointer;
    padding: 0.25rem;
    border-radius: 4px;
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .delete-btn:hover {
    color: #ff6e84;
    background: rgba(255, 110, 132, 0.1);
  }

  .add-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding-top: 0.5rem;
    border-top: 1px solid #242629;
  }

  .add-key {
    width: 140px;
    flex-shrink: 0;
    background: #181a1c;
    border: 1px solid #47484a;
    border-radius: 4px;
    color: #fdfbfe;
    padding: 0.3rem 0.5rem;
    font-size: 0.8rem;
    font-family: 'SF Mono', 'Fira Code', monospace;
  }

  .add-key:focus {
    border-color: #a0a7ff;
    outline: none;
  }

  .add-key.input-error {
    border-color: #ff6e84;
  }

  .add-value {
    flex: 1;
    background: #181a1c;
    border: 1px solid #47484a;
    border-radius: 4px;
    color: #fdfbfe;
    padding: 0.3rem 0.5rem;
    font-size: 0.8rem;
    font-family: 'SF Mono', 'Fira Code', monospace;
  }

  .add-value:focus {
    border-color: #a0a7ff;
    outline: none;
  }

  .add-btn {
    background: #a0a7ff;
    color: #0d0e10;
    border: none;
    border-radius: 4px;
    padding: 0.3rem 0.75rem;
    font-size: 0.8rem;
    font-weight: 500;
    cursor: pointer;
    flex-shrink: 0;
  }

  .add-btn:hover {
    background: #8f97ff;
  }

  .add-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .error-msg {
    color: #ff6e84;
    font-size: 0.75rem;
    margin-top: -0.25rem;
  }
</style>
