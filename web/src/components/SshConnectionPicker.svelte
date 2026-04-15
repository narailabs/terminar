<script lang="ts">
  import { sshConnectionStore } from '../lib/sshConnectionStore.svelte';
  import type { SshConnectionInfo } from '../lib/shared-protocol';

  let {
    onselect,
    onadd,
    onedit,
    ondelete,
    onimport,
    onclose,
  }: {
    onselect?: (connectionId: string, connectionName: string, shell: string) => void;
    onadd?: () => void;
    onedit?: (connection: SshConnectionInfo) => void;
    ondelete?: (id: string) => void;
    onimport?: () => void;
    onclose?: () => void;
  } = $props();

  let selectedShell = $state('/bin/bash');
  const shellOptions = ['/bin/bash', '/bin/sh', '/bin/zsh', '/bin/ash', '/bin/fish'];
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onmousedown={(e) => { if (e.target === e.currentTarget) onclose?.(); }}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="picker" onclick={(e) => e.stopPropagation()} onkeydown={(e) => { if (e.key === 'Escape') onclose?.(); }}>
    <div class="header">
      <h3>SSH Connections</h3>
      <button class="close-btn" onclick={() => onclose?.()}>x</button>
    </div>

    <div class="action-bar">
      <button class="action-btn" onclick={() => onadd?.()}>Add New</button>
      <button class="action-btn" onclick={() => onimport?.()}>Import from ~/.ssh/config</button>
    </div>

    {#if sshConnectionStore.loading}
      <div class="status">Loading connections...</div>
    {:else if sshConnectionStore.error}
      <div class="status error">{sshConnectionStore.error}</div>
    {:else if sshConnectionStore.connections.length === 0}
      <div class="status">No SSH connections. Click 'Add New' or 'Import' to get started.</div>
    {:else}
      <div class="connection-list">
        {#each sshConnectionStore.connections as conn}
          <div class="connection-item">
            <button
              class="connection-main"
              onclick={() => onselect?.(conn.id, conn.name, selectedShell)}
              title="Connect to {conn.name}"
            >
              <div class="connection-name">{conn.name}</div>
              <div class="connection-meta">
                <span class="target">{conn.user}@{conn.host}:{conn.port}</span>
              </div>
            </button>
            <div class="connection-actions">
              <button class="icon-btn" title="Edit" onclick={() => onedit?.(conn)}>edit</button>
              <button class="icon-btn delete" title="Delete" onclick={() => ondelete?.(conn.id)}>delete</button>
            </div>
          </div>
        {/each}
      </div>
    {/if}

    <div class="footer">
      <label>
        Shell:
        <select bind:value={selectedShell}>
          {#each shellOptions as shell}
            <option value={shell}>{shell}</option>
          {/each}
        </select>
      </label>
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
    z-index: 1000;
  }

  .picker {
    background: var(--bg-secondary, #1e1e1e);
    border: 1px solid var(--border-color, #333);
    border-radius: 8px;
    width: 480px;
    max-height: 600px;
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

  .action-bar {
    display: flex;
    gap: 8px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--border-color, #333);
  }

  .action-btn {
    background: var(--bg-primary, #1a1a1a);
    border: 1px solid var(--border-color, #333);
    color: var(--text-primary, #ccc);
    padding: 5px 12px;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
  }

  .action-btn:hover {
    background: var(--bg-hover, #2a2a2a);
  }

  .status {
    padding: 24px 16px;
    text-align: center;
    color: var(--text-secondary, #888);
    font-size: 12px;
  }

  .status.error {
    color: var(--error-color, #f44);
  }

  .connection-list {
    overflow-y: auto;
    max-height: 360px;
  }

  .connection-item {
    display: flex;
    align-items: stretch;
    border-bottom: 1px solid var(--border-color, #333);
  }

  .connection-main {
    flex: 1;
    background: none;
    border: none;
    padding: 10px 16px;
    text-align: left;
    cursor: pointer;
    color: var(--text-primary, #ccc);
  }

  .connection-main:hover {
    background: var(--bg-hover, #2a2a2a);
  }

  .connection-name {
    font-size: 13px;
    font-weight: 500;
  }

  .connection-meta {
    display: flex;
    gap: 8px;
    margin-top: 3px;
    font-size: 11px;
    color: var(--text-secondary, #888);
  }

  .target {
    font-family: var(--font-mono, monospace);
  }

  .connection-actions {
    display: flex;
    align-items: center;
    padding-right: 8px;
    gap: 4px;
  }

  .icon-btn {
    background: none;
    border: none;
    color: var(--text-secondary, #888);
    cursor: pointer;
    font-size: 10px;
    padding: 4px 8px;
    border-radius: 3px;
  }

  .icon-btn:hover {
    background: var(--bg-hover, #2a2a2a);
    color: var(--text-primary, #ccc);
  }

  .icon-btn.delete:hover {
    color: var(--error-color, #f44);
  }

  .footer {
    padding: 10px 16px;
    border-top: 1px solid var(--border-color, #333);
    font-size: 12px;
    color: var(--text-secondary, #888);
  }

  .footer label {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .footer select {
    background: var(--bg-primary, #1a1a1a);
    color: var(--text-primary, #ccc);
    border: 1px solid var(--border-color, #333);
    border-radius: 4px;
    padding: 3px 6px;
    font-size: 12px;
  }
</style>
