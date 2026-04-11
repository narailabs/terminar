<script lang="ts">
  import type { SshConfigHost } from '../lib/shared-protocol';

  let {
    hosts = [],
    onimport,
    onclose,
  }: {
    hosts?: SshConfigHost[];
    onimport?: (selected: SshConfigHost[]) => void;
    onclose?: () => void;
  } = $props();

  let selected = $state(new Set<string>(hosts.map(h => h.name)));

  function toggle(name: string) {
    if (selected.has(name)) {
      selected.delete(name);
    } else {
      selected.add(name);
    }
    selected = new Set(selected);
  }

  function selectAll() {
    selected = new Set(hosts.map(h => h.name));
  }

  function deselectAll() {
    selected = new Set();
  }

  function handleImport() {
    const toImport = hosts.filter(h => selected.has(h.name));
    onimport?.(toImport);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onclick={() => onclose?.()}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="dialog" onclick={(e) => e.stopPropagation()} onkeydown={(e) => { if (e.key === 'Escape') onclose?.(); }}>
    <div class="header">
      <h3>Import from ~/.ssh/config</h3>
      <button class="close-btn" onclick={() => onclose?.()}>x</button>
    </div>

    {#if hosts.length === 0}
      <div class="status">No hosts found in ~/.ssh/config</div>
    {:else}
      <div class="info-note">
        Note: <code>Include</code> directives are not followed. Hosts defined in included files won't appear here.
      </div>
      <div class="toolbar">
        <button class="link" onclick={selectAll}>Select All</button>
        <button class="link" onclick={deselectAll}>Deselect All</button>
        <span class="counter">{selected.size} of {hosts.length} selected</span>
      </div>

      <div class="host-list">
        {#each hosts as host}
          <label class="host-item">
            <input
              type="checkbox"
              checked={selected.has(host.name)}
              onchange={() => toggle(host.name)}
            />
            <div class="host-info">
              <div class="host-name">{host.name}</div>
              <div class="host-meta">
                {#if host.hostname}{host.user ?? '?'}@{host.hostname}{:else}(no hostname){/if}{#if host.port}:{host.port}{/if}
              </div>
            </div>
          </label>
        {/each}
      </div>
    {/if}

    <div class="footer">
      <button class="btn-secondary" onclick={() => onclose?.()}>Cancel</button>
      <button class="btn-primary" onclick={handleImport} disabled={selected.size === 0}>
        Import {selected.size > 0 ? `(${selected.size})` : ''}
      </button>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1100;
  }

  .dialog {
    background: var(--bg-secondary, #1e1e1e);
    border: 1px solid var(--border-color, #333);
    border-radius: 8px;
    width: 450px;
    max-height: 550px;
    display: flex;
    flex-direction: column;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border-color, #333);
  }

  .header h3 {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary, #ccc);
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--text-secondary, #888);
    cursor: pointer;
    font-size: 14px;
    padding: 2px 6px;
  }

  .info-note {
    padding: 8px 16px;
    font-size: 11px;
    color: var(--text-secondary, #888);
    background: rgba(255, 200, 100, 0.08);
    border-bottom: 1px solid var(--border-color, #333);
    line-height: 1.4;
  }

  .info-note code {
    background: rgba(255, 255, 255, 0.08);
    padding: 1px 4px;
    border-radius: 2px;
    font-family: var(--font-mono, monospace);
    font-size: 10px;
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 16px;
    border-bottom: 1px solid var(--border-color, #333);
    font-size: 11px;
    color: var(--text-secondary, #888);
  }

  .link {
    background: none;
    border: none;
    color: var(--accent-color, #0096c8);
    cursor: pointer;
    font-size: 11px;
    padding: 0;
  }

  .link:hover {
    text-decoration: underline;
  }

  .counter {
    margin-left: auto;
  }

  .status {
    padding: 32px 16px;
    text-align: center;
    color: var(--text-secondary, #888);
    font-size: 12px;
  }

  .host-list {
    overflow-y: auto;
    max-height: 340px;
    padding: 4px 0;
  }

  .host-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 16px;
    cursor: pointer;
  }

  .host-item:hover {
    background: var(--bg-hover, #2a2a2a);
  }

  .host-info {
    flex: 1;
    min-width: 0;
  }

  .host-name {
    font-size: 13px;
    color: var(--text-primary, #ccc);
  }

  .host-meta {
    font-size: 11px;
    color: var(--text-secondary, #888);
    font-family: var(--font-mono, monospace);
    margin-top: 2px;
  }

  .footer {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    padding: 10px 16px;
    border-top: 1px solid var(--border-color, #333);
  }

  .btn-primary, .btn-secondary {
    background: var(--bg-primary, #1a1a1a);
    border: 1px solid var(--border-color, #333);
    color: var(--text-primary, #ccc);
    padding: 5px 14px;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
  }

  .btn-primary {
    background: var(--accent-color, #0096c8);
    border-color: var(--accent-color, #0096c8);
    color: #fff;
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-primary:not(:disabled):hover {
    opacity: 0.9;
  }

  .btn-secondary:hover {
    background: var(--bg-hover, #2a2a2a);
  }
</style>
