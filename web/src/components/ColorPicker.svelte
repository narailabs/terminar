<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export let value: string = '#cccccc';
  export let label: string = '';
  export let id: string = '';
  export let showOpacity: boolean = false;

  const dispatch = createEventDispatcher<{ change: string }>();

  // Parse value into hex + opacity
  function parseColor(val: string): { hex: string; opacity: number } {
    const rgbaMatch = val.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/);
    if (rgbaMatch) {
      const r = parseInt(rgbaMatch[1]);
      const g = parseInt(rgbaMatch[2]);
      const b = parseInt(rgbaMatch[3]);
      const a = rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 1;
      const hex = '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
      return { hex, opacity: a };
    }
    if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
      return { hex: val, opacity: 1 };
    }
    return { hex: '#cccccc', opacity: 1 };
  }

  function toOutput(hex: string, opacity: number): string {
    if (opacity >= 1) return hex;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${opacity})`;
  }

  let hexPart: string;
  let opacityPart: number;
  $: ({ hex: hexPart, opacity: opacityPart } = parseColor(value));

  function handleInput(event: Event) {
    const target = event.target as HTMLInputElement;
    hexPart = target.value;
    dispatch('change', toOutput(hexPart, opacityPart));
  }

  function handleTextInput(event: Event) {
    const target = event.target as HTMLInputElement;
    const newValue = target.value;
    if (/^#[0-9A-Fa-f]{6}$/.test(newValue)) {
      hexPart = newValue;
      dispatch('change', toOutput(hexPart, opacityPart));
    }
  }

  function handleOpacityInput(event: Event) {
    const target = event.target as HTMLInputElement;
    opacityPart = parseInt(target.value, 10) / 100;
    dispatch('change', toOutput(hexPart, opacityPart));
  }
</script>

<div class="color-picker">
  {#if label}
    <label for={id}>{label}</label>
  {/if}
  <div class="color-input-wrapper" class:with-opacity={showOpacity}>
    <input
      type="color"
      {id}
      value={hexPart}
      on:input={handleInput}
      class="color-input"
    />
    <input
      type="text"
      value={hexPart}
      on:change={handleTextInput}
      placeholder="#000000"
      maxlength="7"
      class="hex-input"
    />
    {#if showOpacity}
      <input
        type="range"
        min="0"
        max="100"
        step="1"
        value={Math.round(opacityPart * 100)}
        on:input={handleOpacityInput}
        class="opacity-slider"
      />
      <span class="opacity-value">{Math.round(opacityPart * 100)}%</span>
    {/if}
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
    color: var(--ui-text-primary, #fdfbfe);
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
    background: var(--ui-bg-tertiary, #242629);
    border: 1px solid var(--ui-border, #555);
    border-radius: 4px;
    color: var(--ui-text-primary, white);
    font-size: 13px;
    font-family: monospace;
    width: 80px;
  }

  .with-opacity .hex-input {
    flex: 0;
    width: 76px;
    min-width: 76px;
  }

  .hex-input:focus {
    outline: none;
    border-color: var(--ui-accent, #a0a7ff);
  }

  .opacity-slider {
    flex: 1;
    height: 4px;
    -webkit-appearance: none;
    appearance: none;
    background: var(--ui-bg-tertiary, #242629);
    border-radius: 2px;
    outline: none;
    min-width: 60px;
  }

  .opacity-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 14px;
    height: 14px;
    background: var(--ui-accent, #a0a7ff);
    border-radius: 50%;
    cursor: pointer;
  }

  .opacity-slider::-moz-range-thumb {
    width: 14px;
    height: 14px;
    background: var(--ui-accent, #a0a7ff);
    border-radius: 50%;
    cursor: pointer;
    border: none;
  }

  .opacity-value {
    font-size: 11px;
    color: var(--ui-text-secondary, #ababad);
    font-family: monospace;
    min-width: 32px;
    text-align: right;
  }
</style>
