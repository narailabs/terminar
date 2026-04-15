<script lang="ts">
  import { containerStore, LOCAL_HOST, type HostKey } from '../lib/containerStore.svelte';
  import { sshConnectionStore } from '../lib/sshConnectionStore.svelte';

  let {
    onselect,
    onhostchange,
    onclose,
  }: {
    onselect?: (
      containerId: string,
      containerName: string,
      shell: string,
      sshConnectionId?: string,
    ) => void;
    /** Fires when the user picks a different Docker host. Caller should request the list for the new host. */
    onhostchange?: (host: HostKey) => void;
    onclose?: () => void;
  } = $props();

  let selectedShell = $state('/bin/bash');
  const shellOptions = ['/bin/bash', '/bin/sh', '/bin/ash', '/bin/zsh'];

  let selectedHost = $derived(containerStore.selectedHost);

  function handleHostChange(e: Event) {
    const key = (e.target as HTMLSelectElement).value;
    containerStore.setSelectedHost(key);
    onhostchange?.(key);
  }

  function handleSelect(container: { id: string; name: string }) {
    const ssh = selectedHost === LOCAL_HOST ? undefined : selectedHost;
    onselect?.(container.id, container.name, selectedShell, ssh);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onmousedown={(e) => { if (e.target === e.currentTarget) onclose?.(); }}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="picker" onclick={(e) => e.stopPropagation()} onkeydown={(e) => { if (e.key === 'Escape') onclose?.(); }}>
    <div class="header">
      <h3>Docker Containers</h3>
      <button class="close-btn" onclick={() => onclose?.()}>x</button>
    </div>

    <div class="host-bar">
      <label>
        Host:
        <select value={selectedHost} onchange={handleHostChange}>
          <option value={LOCAL_HOST}>Local Docker</option>
          {#each sshConnectionStore.connections as conn}
            <option value={conn.id}>{conn.name} ({conn.user}@{conn.host})</option>
          {/each}
        </select>
      </label>
    </div>

    {#if containerStore.loading}
      <div class="status">Loading containers...</div>
    {:else if containerStore.error}
      <div class="status error">{containerStore.error}</div>
    {:else if containerStore.containers.length === 0}
      <div class="status">No running containers found</div>
    {:else}
      <div class="container-list">
        {#each containerStore.containers as container}
          <button
            class="container-item"
            onclick={() => handleSelect(container)}
          >
            <div class="container-name">{container.name}</div>
            <div class="container-meta">
              <span class="image">{container.image}</span>
              <span class="status-text">{container.status}</span>
            </div>
          </button>
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
    width: 400px;
    max-height: 500px;
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

  .host-bar {
    padding: 10px 16px;
    border-bottom: 1px solid var(--border-color, #333);
    font-size: 12px;
    color: var(--text-secondary, #888);
  }

  .host-bar label {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .host-bar select {
    background: var(--bg-primary, #1a1a1a);
    color: var(--text-primary, #ccc);
    border: 1px solid var(--border-color, #333);
    border-radius: 4px;
    padding: 3px 6px;
    font-size: 12px;
    flex: 1;
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

  .container-list {
    overflow-y: auto;
    max-height: 340px;
  }

  .container-item {
    display: block;
    width: 100%;
    padding: 10px 16px;
    background: none;
    border: none;
    border-bottom: 1px solid var(--border-color, #333);
    cursor: pointer;
    text-align: left;
    color: var(--text-primary, #ccc);
  }

  .container-item:hover {
    background: var(--bg-hover, #2a2a2a);
  }

  .container-name {
    font-size: 13px;
    font-weight: 500;
  }

  .container-meta {
    display: flex;
    gap: 8px;
    margin-top: 3px;
    font-size: 11px;
    color: var(--text-secondary, #888);
  }

  .image {
    opacity: 0.8;
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
