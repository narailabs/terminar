<script lang="ts">
  interface Props {
    filename: string;
    initialContents: string;
    onSave: (newContents: string) => void;
    onCancel: () => void;
  }

  let { filename, initialContents, onSave, onCancel }: Props = $props();

  // Intentionally snapshot the initial value once — NOT reactive.
  let contents = $state(initialContents);
  let textareaEl: HTMLTextAreaElement | null = $state(null);

  const basename = $derived(filename.split('/').pop() || filename);
  const headingId = `editor-modal-title-${Math.random().toString(36).slice(2, 10)}`;

  // Auto-focus the textarea when the modal mounts.
  $effect(() => {
    if (textareaEl) {
      textareaEl.focus();
      // Place cursor at end of pre-filled contents so the user can start
      // appending immediately without hunting for the cursor.
      const len = textareaEl.value.length;
      try {
        textareaEl.setSelectionRange(len, len);
      } catch {
        // Some test environments throw on setSelectionRange — ignore.
      }
    }
  });

  function handleSave() {
    onSave(contents);
  }

  function handleCancel() {
    onCancel();
  }

  function handleKeydown(event: KeyboardEvent) {
    // Cmd/Ctrl + S → save
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      onSave(contents);
      return;
    }

    // Cmd/Ctrl + Enter → save (convenience)
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      onSave(contents);
      return;
    }

    // Escape → cancel
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
      return;
    }
  }

  // Backdrop click intentionally does NOT close the modal — prevents
  // accidents while typing. Just stop propagation if the click lands on the
  // card so it doesn't bubble back up to anything outside.
  function handleCardClick(event: MouseEvent) {
    event.stopPropagation();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_interactive_supports_focus -->
<div
  class="editor-modal-backdrop"
  role="dialog"
  aria-modal="true"
  aria-labelledby={headingId}
  onkeydown={handleKeydown}
>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="editor-modal-card" role="document" onclick={handleCardClick}>
    <header class="editor-modal-header">
      <h2 id={headingId} class="editor-modal-title">
        Edit file: <span class="editor-modal-filename" title={filename}>{basename}</span>
      </h2>
    </header>

    <div class="editor-modal-body">
      <label class="editor-modal-label sr-only" for="editor-modal-textarea">
        Contents of {basename}
      </label>
      <textarea
        id="editor-modal-textarea"
        class="editor-modal-textarea"
        bind:value={contents}
        bind:this={textareaEl}
        spellcheck="false"
        autocomplete="off"
        autocapitalize="off"
        data-testid="editor-modal-textarea"
      ></textarea>
    </div>

    <footer class="editor-modal-footer">
      <button
        type="button"
        class="editor-modal-btn editor-modal-btn-cancel"
        onclick={handleCancel}
        data-testid="editor-modal-cancel"
      >
        Cancel
      </button>
      <button
        type="button"
        class="editor-modal-btn editor-modal-btn-save"
        onclick={handleSave}
        data-testid="editor-modal-save"
      >
        Save
      </button>
    </footer>
  </div>
</div>

<style>
  .editor-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1200;
  }

  .editor-modal-card {
    zoom: var(--controls-zoom, 1);
    background: var(--ui-bg-secondary, #181a1c);
    border: 1px solid var(--ui-border, #47484a);
    border-radius: 8px;
    width: 80%;
    height: 80%;
    max-width: 1200px;
    max-height: 800px;
    display: flex;
    flex-direction: column;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    overflow: hidden;
  }

  .editor-modal-header {
    padding: 14px 20px;
    border-bottom: 1px solid var(--ui-border, #47484a);
    flex-shrink: 0;
  }

  .editor-modal-title {
    margin: 0;
    font-size: 14px;
    font-weight: 500;
    color: var(--ui-text-secondary, #ababad);
  }

  .editor-modal-filename {
    color: var(--ui-text-primary, #e0e0e0);
    font-family: var(--font-mono, 'SF Mono', 'Menlo', 'Consolas', monospace);
    font-weight: 500;
  }

  .editor-modal-body {
    flex: 1;
    min-height: 0;
    display: flex;
    padding: 12px 16px;
  }

  .editor-modal-label {
    display: block;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .editor-modal-textarea {
    flex: 1;
    width: 100%;
    height: 100%;
    resize: none;
    box-sizing: border-box;
    background: var(--ui-bg-primary, #0d0e10);
    color: var(--ui-text-primary, #e0e0e0);
    border: 1px solid var(--ui-border, #47484a);
    border-radius: 4px;
    padding: 10px 12px;
    font-family: var(--font-mono, 'SF Mono', 'Menlo', 'Consolas', monospace);
    font-size: 13px;
    line-height: 1.5;
    tab-size: 4;
    -moz-tab-size: 4;
    outline: none;
  }

  .editor-modal-textarea:focus {
    border-color: var(--ui-accent, #a0a7ff);
  }

  .editor-modal-footer {
    padding: 12px 20px;
    border-top: 1px solid var(--ui-border, #47484a);
    flex-shrink: 0;
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .editor-modal-btn {
    border-radius: 4px;
    padding: 6px 18px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    border: 1px solid transparent;
    transition: filter 0.1s;
  }

  .editor-modal-btn-cancel {
    background: var(--ui-bg-secondary, #181a1c);
    color: var(--ui-text-primary, #e0e0e0);
    border-color: var(--ui-border, #47484a);
  }

  .editor-modal-btn-cancel:hover {
    background: var(--ui-bg-tertiary, #242629);
  }

  .editor-modal-btn-save {
    background: var(--ui-accent, #a0a7ff);
    color: var(--ui-bg-primary, #0d0e10);
  }

  .editor-modal-btn-save:hover {
    filter: brightness(1.1);
  }
</style>
