<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';

  export let isOpen: boolean = false;
  export let currentMatch: number = 0;
  export let totalMatches: number = 0;
  export let caseSensitive: boolean = false;
  export let useRegex: boolean = false;

  let inputElement: HTMLInputElement;
  let query = '';
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const dispatch = createEventDispatcher<{
    search: { query: string; caseSensitive: boolean; useRegex: boolean };
    next: void;
    previous: void;
    close: void;
    toggleCaseSensitive: void;
    toggleRegex: void;
  }>();

  // Focus input when search bar opens
  $: if (isOpen && inputElement) {
    // Use microtask to ensure DOM is updated
    queueMicrotask(() => {
      inputElement?.focus();
      inputElement?.select();
    });
  }

  function handleInput() {
    // Debounce incremental search at 150ms
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      dispatch('search', { query, caseSensitive, useRegex });
      debounceTimer = null;
    }, 150);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (event.shiftKey) {
        dispatch('previous');
      } else {
        dispatch('next');
      }
    }
  }

  function close() {
    query = '';
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    dispatch('close');
  }

  function handleNext() {
    dispatch('next');
  }

  function handlePrevious() {
    dispatch('previous');
  }

  function handleToggleCaseSensitive() {
    dispatch('toggleCaseSensitive');
    // Re-search with updated settings after a tick
    queueMicrotask(() => {
      dispatch('search', { query, caseSensitive: !caseSensitive, useRegex });
    });
  }

  function handleToggleRegex() {
    dispatch('toggleRegex');
    queueMicrotask(() => {
      dispatch('search', { query, caseSensitive, useRegex: !useRegex });
    });
  }

  onDestroy(() => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
  });
</script>

{#if isOpen}
  <div class="search-bar" role="search" aria-label="Search in terminal">
    <div class="search-input-wrapper">
      <input
        bind:this={inputElement}
        bind:value={query}
        on:input={handleInput}
        on:keydown={handleKeydown}
        type="text"
        class="search-input"
        placeholder="Search..."
        aria-label="Search term"
      />
      <span class="match-count" aria-live="polite">
        {#if query && totalMatches > 0}
          {currentMatch} of {totalMatches}
        {:else if query && totalMatches === 0}
          No matches
        {/if}
      </span>
    </div>

    <div class="search-buttons">
      <button
        class="search-toggle-btn"
        class:active={caseSensitive}
        on:click={handleToggleCaseSensitive}
        title="Match Case"
        aria-label="Toggle case sensitivity"
        aria-pressed={caseSensitive}
      >Aa</button>

      <button
        class="search-toggle-btn"
        class:active={useRegex}
        on:click={handleToggleRegex}
        title="Use Regular Expression"
        aria-label="Toggle regex"
        aria-pressed={useRegex}
      >.*</button>

      <button
        class="search-nav-btn"
        on:click={handlePrevious}
        title="Previous Match (Shift+Enter)"
        aria-label="Previous match"
        disabled={totalMatches === 0}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 3.5L3 8.5h3V13h4V8.5h3L8 3.5z"/>
        </svg>
      </button>

      <button
        class="search-nav-btn"
        on:click={handleNext}
        title="Next Match (Enter)"
        aria-label="Next match"
        disabled={totalMatches === 0}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 12.5L13 7.5h-3V3H6v4.5H3l5 5z"/>
        </svg>
      </button>

      <button
        class="search-close-btn"
        on:click={close}
        title="Close (Escape)"
        aria-label="Close search"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 8.707l3.646 3.647.708-.708L8.707 8l3.647-3.646-.708-.708L8 7.293 4.354 3.646l-.708.708L7.293 8l-3.647 3.646.708.708L8 8.707z"/>
        </svg>
      </button>
    </div>
  </div>
{/if}

<style>
  .search-bar {
    position: absolute;
    top: 0;
    right: 16px;
    z-index: 150;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    background: var(--ui-bg-secondary, #252526);
    border: 1px solid var(--ui-border, #3c3c3c);
    border-top: none;
    border-radius: 0 0 6px 6px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
    animation: slideDown 0.15s ease-out;
  }

  @keyframes slideDown {
    from { transform: translateY(-100%); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }

  .search-input-wrapper {
    display: flex;
    align-items: center;
    background: var(--ui-bg-tertiary, #3c3c3c);
    border: 1px solid var(--ui-border, #555);
    border-radius: 3px;
    padding: 0 6px;
  }

  .search-input-wrapper:focus-within {
    border-color: var(--ui-accent, #0e639c);
  }

  .search-input {
    width: 200px;
    padding: 4px 4px;
    background: transparent;
    border: none;
    color: var(--ui-text-primary, #cccccc);
    font-size: 12px;
    font-family: inherit;
    outline: none;
  }

  .search-input::placeholder {
    color: var(--ui-text-muted, #666);
  }

  .match-count {
    font-size: 11px;
    color: var(--ui-text-muted, #888);
    white-space: nowrap;
    padding: 0 4px;
    min-width: 60px;
    text-align: right;
  }

  .search-buttons {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .search-toggle-btn,
  .search-nav-btn,
  .search-close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 3px;
    color: var(--ui-text-muted, #888);
    cursor: pointer;
    font-size: 11px;
    font-weight: 600;
    transition: all 0.1s;
  }

  .search-toggle-btn:hover,
  .search-nav-btn:hover,
  .search-close-btn:hover {
    background: var(--ui-bg-tertiary, #3c3c3c);
    color: var(--ui-text-primary, #cccccc);
  }

  .search-toggle-btn.active {
    background: var(--ui-accent, #0e639c);
    color: white;
    border-color: var(--ui-accent, #0e639c);
  }

  .search-nav-btn:disabled,
  .search-close-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .search-close-btn:hover {
    color: var(--ui-destructive, #f48771);
  }
</style>
