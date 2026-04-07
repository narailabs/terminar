<script lang="ts">
  import ColorPicker from './ColorPicker.svelte';
  import { tagStore, TAG_COLORS, type TagDefinition } from '../lib/tagStore.svelte';

  let {
    isOpen = false,
    onclose,
  }: {
    isOpen?: boolean;
    onclose?: () => void;
  } = $props();

  function contrastColor(hex: string): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 > 128 ? '#000' : '#fff';
  }

  // Editing state
  let editingId: string | null = $state(null);
  let editName: string = $state('');
  let editBgColor: string = $state(TAG_COLORS[0]);
  let editFontColorAuto: boolean = $state(true);
  let editFontColor: string = $state('#ffffff');

  // Adding state
  let adding: boolean = $state(false);
  let newName: string = $state('');
  let newBgColor: string = $state(TAG_COLORS[0]);
  let newFontColorAuto: boolean = $state(true);
  let newFontColor: string = $state('#ffffff');

  function startEdit(def: TagDefinition) {
    adding = false;
    editingId = def.id;
    editName = def.name;
    editBgColor = def.color;
    editFontColorAuto = !def.fontColor;
    editFontColor = def.fontColor || contrastColor(def.color);
  }

  function saveEdit() {
    if (!editingId || !editName.trim()) return;
    tagStore.updateDefinition(editingId, editName.trim(), editBgColor, editFontColorAuto ? undefined : editFontColor);
    editingId = null;
  }

  function cancelEdit() {
    editingId = null;
  }

  function startAdd() {
    editingId = null;
    adding = true;
    newName = '';
    newBgColor = TAG_COLORS[0];
    newFontColorAuto = true;
    newFontColor = '#ffffff';
  }

  function saveAdd() {
    if (!newName.trim()) return;
    tagStore.addDefinition(newName.trim(), newBgColor, newFontColorAuto ? undefined : newFontColor);
    adding = false;
    newName = '';
    newBgColor = TAG_COLORS[0];
    newFontColorAuto = true;
    newFontColor = '#ffffff';
  }

  function cancelAdd() {
    adding = false;
  }

  function handleDelete(id: string) {
    tagStore.deleteDefinition(id);
    if (editingId === id) editingId = null;
  }

  function handleClose() {
    editingId = null;
    adding = false;
    onclose?.();
  }

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) {
      handleClose();
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') handleClose();
  }

  function handleEditKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') saveEdit();
    else if (event.key === 'Escape') cancelEdit();
  }

  function handleAddKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') saveAdd();
    else if (event.key === 'Escape') cancelAdd();
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if isOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="modal-backdrop" onclick={handleBackdropClick} role="dialog" aria-modal="true">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="editor-panel" role="document" onclick={(e) => e.stopPropagation()}>
      <div class="panel-header">
        <h2>Edit Tags</h2>
        <button class="close-btn" onclick={handleClose}>&times;</button>
      </div>

      <div class="panel-content">
        <!-- Tag list -->
        <div class="tag-list">
          {#each tagStore.definitions as def (def.id)}
            {#if editingId === def.id}
              <!-- Inline edit form -->
              <div class="tag-form">
                <div class="form-row">
                  <label class="form-label">Name</label>
                  <input type="text" class="tag-name-input" bind:value={editName}
                         onkeydown={handleEditKeydown} />
                </div>

                <div class="form-row">
                  <label class="form-label">Background</label>
                  <div class="color-row">
                    <ColorPicker
                      id="editBgColor"
                      value={editBgColor}
                      on:change={(e) => { editBgColor = e.detail; if (editFontColorAuto) editFontColor = contrastColor(editBgColor); }}
                    />
                  </div>
                  <div class="preset-swatches">
                    {#each TAG_COLORS as color}
                      <button
                        class="swatch"
                        class:selected={editBgColor === color}
                        style="background: {color}"
                        onclick={() => { editBgColor = color; if (editFontColorAuto) editFontColor = contrastColor(color); }}
                      ></button>
                    {/each}
                  </div>
                </div>

                <div class="form-row">
                  <label class="form-label">Font Color</label>
                  <label class="auto-toggle">
                    <input type="checkbox" bind:checked={editFontColorAuto}
                           onchange={() => { if (editFontColorAuto) editFontColor = contrastColor(editBgColor); }} />
                    Auto (from background)
                  </label>
                  {#if !editFontColorAuto}
                    <div class="color-row">
                      <ColorPicker
                        id="editFontColor"
                        value={editFontColor}
                        on:change={(e) => editFontColor = e.detail}
                      />
                    </div>
                  {/if}
                </div>

                <div class="form-row">
                  <label class="form-label">Preview</label>
                  <span class="tag-preview" style="background: {editBgColor}; color: {editFontColorAuto ? contrastColor(editBgColor) : editFontColor}">
                    {editName || 'Tag'}
                  </span>
                </div>

                <div class="form-actions">
                  <button class="btn-save" onclick={saveEdit} disabled={!editName.trim()}>Save</button>
                  <button class="btn-cancel" onclick={cancelEdit}>Cancel</button>
                </div>
              </div>
            {:else}
              <!-- Tag row -->
              <div class="tag-row">
                <span class="tag-preview" style="background: {def.color}; color: {def.fontColor || contrastColor(def.color)}">
                  {def.name}
                </span>
                <span class="tag-row-spacer"></span>
                <button class="btn-edit" onclick={() => startEdit(def)}>Edit</button>
                <button class="btn-delete" onclick={() => handleDelete(def.id)}>&times;</button>
              </div>
            {/if}
          {/each}
        </div>

        <!-- Add form -->
        {#if adding}
          <div class="tag-form add-form">
            <div class="form-row">
              <label class="form-label">Name</label>
              <input type="text" class="tag-name-input" bind:value={newName}
                     onkeydown={handleAddKeydown} placeholder="Tag name" />
            </div>

            <div class="form-row">
              <label class="form-label">Background</label>
              <div class="color-row">
                <ColorPicker
                  id="newBgColor"
                  value={newBgColor}
                  on:change={(e) => { newBgColor = e.detail; if (newFontColorAuto) newFontColor = contrastColor(newBgColor); }}
                />
              </div>
              <div class="preset-swatches">
                {#each TAG_COLORS as color}
                  <button
                    class="swatch"
                    class:selected={newBgColor === color}
                    style="background: {color}"
                    onclick={() => { newBgColor = color; if (newFontColorAuto) newFontColor = contrastColor(color); }}
                  ></button>
                {/each}
              </div>
            </div>

            <div class="form-row">
              <label class="form-label">Font Color</label>
              <label class="auto-toggle">
                <input type="checkbox" bind:checked={newFontColorAuto}
                       onchange={() => { if (newFontColorAuto) newFontColor = contrastColor(newBgColor); }} />
                Auto (from background)
              </label>
              {#if !newFontColorAuto}
                <div class="color-row">
                  <ColorPicker
                    id="newFontColor"
                    value={newFontColor}
                    on:change={(e) => newFontColor = e.detail}
                  />
                </div>
              {/if}
            </div>

            <div class="form-row">
              <label class="form-label">Preview</label>
              <span class="tag-preview" style="background: {newBgColor}; color: {newFontColorAuto ? contrastColor(newBgColor) : newFontColor}">
                {newName || 'Tag'}
              </span>
            </div>

            <div class="form-actions">
              <button class="btn-save" onclick={saveAdd} disabled={!newName.trim()}>Add</button>
              <button class="btn-cancel" onclick={cancelAdd}>Cancel</button>
            </div>
          </div>
        {:else}
          <button class="btn-add" onclick={startAdd}>+ Add Tag</button>
        {/if}
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
    zoom: var(--controls-zoom, 1);
    background: var(--ui-bg-secondary, #181a1c);
    border: 1px solid var(--ui-border, #47484a);
    border-radius: 8px;
    width: 480px;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  }

  .panel-header {
    padding: 16px 20px;
    border-bottom: 1px solid var(--ui-border, #47484a);
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
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
    font-size: 20px;
    cursor: pointer;
    padding: 0 4px;
    line-height: 1;
  }

  .close-btn:hover {
    color: var(--ui-text-primary, #e0e0e0);
  }

  .panel-content {
    padding: 16px 20px;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  }

  /* Tag list */
  .tag-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 12px;
  }

  .tag-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 4px;
  }

  .tag-row:hover {
    background: var(--ui-bg-tertiary, #242629);
  }

  .tag-row-spacer {
    flex: 1;
  }

  .tag-preview {
    font-size: 12px;
    padding: 2px 10px;
    border-radius: 3px;
    white-space: nowrap;
    font-weight: 500;
  }

  /* Form */
  .tag-form {
    background: var(--ui-bg-tertiary, #242629);
    border: 1px solid var(--ui-border, #47484a);
    border-radius: 6px;
    padding: 12px 14px;
    margin-bottom: 8px;
  }

  .add-form {
    margin-top: 4px;
    margin-bottom: 0;
  }

  .form-row {
    margin-bottom: 10px;
  }

  .form-row:last-of-type {
    margin-bottom: 12px;
  }

  .form-label {
    display: block;
    font-size: 11px;
    font-weight: 500;
    color: var(--ui-text-secondary, #ababad);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 6px;
  }

  .tag-name-input {
    width: 100%;
    padding: 6px 10px;
    background: var(--ui-bg-secondary, #181a1c);
    border: 1px solid var(--ui-border, #555);
    border-radius: 4px;
    color: var(--ui-text-primary, #fdfbfe);
    font-size: 13px;
    box-sizing: border-box;
  }

  .tag-name-input:focus {
    outline: none;
    border-color: var(--ui-accent, #a0a7ff);
  }

  .color-row {
    margin-bottom: 6px;
  }

  .preset-swatches {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }

  .swatch {
    width: 18px;
    height: 18px;
    border-radius: 3px;
    border: 2px solid transparent;
    cursor: pointer;
    padding: 0;
    transition: transform 0.1s;
  }

  .swatch.selected {
    border-color: white;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.3);
  }

  .swatch:hover {
    transform: scale(1.15);
  }

  .auto-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--ui-text-primary, #fdfbfe);
    cursor: pointer;
    margin-bottom: 6px;
  }

  .auto-toggle input[type="checkbox"] {
    accent-color: var(--ui-accent, #a0a7ff);
  }

  /* Buttons */
  .form-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }

  .btn-edit, .btn-delete {
    background: none;
    border: none;
    cursor: pointer;
    padding: 2px 8px;
    border-radius: 3px;
    font-size: 12px;
  }

  .btn-edit {
    color: var(--ui-text-secondary, #ababad);
  }

  .btn-edit:hover {
    color: var(--ui-accent, #a0a7ff);
    background: var(--ui-bg-tertiary, #242629);
  }

  .btn-delete {
    color: var(--ui-text-muted, #757578);
    font-size: 16px;
  }

  .btn-delete:hover {
    color: var(--ui-destructive, #e06c75);
  }

  .btn-save {
    background: var(--ui-accent, #a0a7ff);
    color: #0d0e10;
    border: none;
    border-radius: 4px;
    padding: 5px 16px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
  }

  .btn-save:hover {
    filter: brightness(1.1);
  }

  .btn-save:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-cancel {
    background: var(--ui-bg-secondary, #181a1c);
    color: var(--ui-text-primary, #fdfbfe);
    border: 1px solid var(--ui-border, #47484a);
    border-radius: 4px;
    padding: 5px 16px;
    font-size: 12px;
    cursor: pointer;
  }

  .btn-cancel:hover {
    background: var(--ui-bg-hover, #4a4a4a);
  }

  .btn-add {
    background: none;
    border: 1px dashed var(--ui-border, #47484a);
    border-radius: 6px;
    color: var(--ui-text-secondary, #ababad);
    padding: 8px 16px;
    font-size: 12px;
    cursor: pointer;
    width: 100%;
    text-align: center;
    transition: all 0.15s;
  }

  .btn-add:hover {
    border-color: var(--ui-accent, #a0a7ff);
    color: var(--ui-accent, #a0a7ff);
    background: var(--ui-bg-tertiary, #242629);
  }
</style>
