<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export let value: string = '#cccccc';
  export let label: string = '';
  export let id: string = '';

  const dispatch = createEventDispatcher<{ change: string }>();

  function handleInput(event: Event) {
    const target = event.target as HTMLInputElement;
    dispatch('change', target.value);
  }

  function handleTextInput(event: Event) {
    const target = event.target as HTMLInputElement;
    const newValue = target.value;
    // Validate hex color format
    if (/^#[0-9A-Fa-f]{6}$/.test(newValue)) {
      dispatch('change', newValue);
    }
  }
</script>

<div class="color-picker">
  {#if label}
    <label for={id}>{label}</label>
  {/if}
  <div class="color-input-wrapper">
    <input
      type="color"
      {id}
      {value}
      on:input={handleInput}
      class="color-input"
    />
    <input
      type="text"
      value={value}
      on:change={handleTextInput}
      placeholder="#000000"
      maxlength="7"
      class="hex-input"
    />
  </div>
</div>

<style>
  .color-picker {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  label {
    font-size: 12px;
    color: var(--ui-text-primary, #ccc);
    font-weight: 500;
  }

  .color-input-wrapper {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .color-input {
    width: 40px;
    height: 32px;
    padding: 0;
    border: 1px solid var(--ui-border, #555);
    border-radius: 4px;
    cursor: pointer;
    background: transparent;
  }

  .color-input::-webkit-color-swatch-wrapper {
    padding: 2px;
  }

  .color-input::-webkit-color-swatch {
    border-radius: 2px;
    border: none;
  }

  .hex-input {
    flex: 1;
    padding: 6px 10px;
    background: var(--ui-bg-tertiary, #3c3c3c);
    border: 1px solid var(--ui-border, #555);
    border-radius: 4px;
    color: var(--ui-text-primary, white);
    font-size: 13px;
    font-family: monospace;
    width: 80px;
  }

  .hex-input:focus {
    outline: none;
    border-color: var(--ui-accent, #0e639c);
  }
</style>
