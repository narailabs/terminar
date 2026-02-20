<script lang="ts">
  import { broadcastTargets, broadcastInput } from '../lib/broadcastStore.svelte';

  let { onClose = undefined }: {
    onClose?: (() => void) | undefined;
  } = $props();

  let inputValue = $state('');

  let targetCount = $derived(broadcastTargets.value.size);

  function handleSend() {
    if (!inputValue.trim()) return;
    broadcastInput(inputValue + '\n');
    inputValue = '';
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleSend();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose?.();
    }
  }
</script>

<div class="broadcast-bar" role="toolbar" aria-label="Broadcast input">
  <div class="broadcast-status">
    {#if targetCount > 0}
      <span class="target-count">Broadcasting to {targetCount} session{targetCount !== 1 ? 's' : ''}</span>
    {:else}
      <span class="no-targets">No targets selected</span>
    {/if}
  </div>
  <div class="broadcast-input-row">
    <input
      type="text"
      class="broadcast-input"
      placeholder="Broadcast input to all targets..."
      bind:value={inputValue}
      onkeydown={handleKeyDown}
    />
    <button
      class="send-btn"
      onclick={handleSend}
      aria-label="Send"
    >Send</button>
  </div>
</div>

<style>
  .broadcast-bar {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 12px;
    background: var(--ui-bg-secondary, #252526);
    border-top: 2px solid var(--ui-accent, #0e639c);
    flex-shrink: 0;
  }

  .broadcast-status {
    font-size: 11px;
    color: var(--ui-text-muted, #888);
  }

  .target-count {
    color: var(--ui-accent, #0e639c);
    font-weight: 500;
  }

  .no-targets {
    color: var(--ui-text-muted, #666);
    font-style: italic;
  }

  .broadcast-input-row {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .broadcast-input {
    flex: 1;
    padding: 6px 10px;
    background: var(--ui-bg-tertiary, #3c3c3c);
    border: 1px solid var(--ui-border, #555);
    border-radius: 4px;
    color: var(--ui-text-primary, #ccc);
    font-size: 13px;
    font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
    outline: none;
  }

  .broadcast-input:focus {
    border-color: var(--ui-accent, #0e639c);
  }

  .broadcast-input::placeholder {
    color: var(--ui-text-muted, #666);
  }

  .send-btn {
    padding: 6px 14px;
    background: var(--ui-accent, #0e639c);
    border: none;
    border-radius: 4px;
    color: white;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s;
    white-space: nowrap;
  }

  .send-btn:hover {
    background: var(--ui-accent-hover, #1177bb);
  }

  .send-btn:active {
    background: var(--ui-accent, #0a5289);
  }
</style>
