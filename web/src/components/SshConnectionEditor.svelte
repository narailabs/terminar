<script lang="ts">
  import type { SshConnectionInfo } from '../lib/shared-protocol';

  let {
    connection,
    onsave,
    oncancel,
  }: {
    connection?: SshConnectionInfo;
    onsave?: (name: string, host: string, user: string, port: number) => void;
    oncancel?: () => void;
  } = $props();

  let name = $state(connection?.name ?? '');
  let host = $state(connection?.host ?? '');
  let user = $state(connection?.user ?? '');
  let port = $state(connection?.port ?? 22);
  let error = $state<string | null>(null);

  const isEditMode = $derived(!!connection);

  function handleSave() {
    error = null;
    if (!name.trim()) { error = 'Name is required'; return; }
    if (!host.trim()) { error = 'Host is required'; return; }
    if (!user.trim()) { error = 'User is required'; return; }
    if (port < 1 || port > 65535) { error = 'Port must be between 1 and 65535'; return; }
    onsave?.(name.trim(), host.trim(), user.trim(), port);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onmousedown={(e) => { if (e.target === e.currentTarget) oncancel?.(); }}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="editor" onclick={(e) => e.stopPropagation()} onkeydown={(e) => { if (e.key === 'Escape') oncancel?.(); }}>
    <div class="header">
      <h3>{isEditMode ? 'Edit SSH Connection' : 'Add SSH Connection'}</h3>
      <button class="close-btn" onclick={() => oncancel?.()}>x</button>
    </div>

    <div class="form">
      <label>
        <span>Name</span>
        <input type="text" bind:value={name} placeholder="Production server" />
      </label>
      <label>
        <span>Host</span>
        <input type="text" bind:value={host} placeholder="server.example.com" />
      </label>
      <label>
        <span>User</span>
        <input type="text" bind:value={user} placeholder="deploy" />
      </label>
      <label>
        <span>Port</span>
        <input type="number" bind:value={port} min="1" max="65535" />
      </label>

      {#if error}
        <div class="error">{error}</div>
      {/if}
    </div>

    <div class="footer">
      <button class="btn-secondary" onclick={() => oncancel?.()}>Cancel</button>
      <button class="btn-primary" onclick={handleSave}>{isEditMode ? 'Update' : 'Add'}</button>
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

  .editor {
    background: var(--bg-secondary, #1e1e1e);
    border: 1px solid var(--border-color, #333);
    border-radius: 8px;
    width: 400px;
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

  .form {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .form label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: var(--text-secondary, #888);
  }

  .form input {
    background: var(--bg-primary, #1a1a1a);
    border: 1px solid var(--border-color, #333);
    color: var(--text-primary, #ccc);
    padding: 6px 10px;
    border-radius: 4px;
    font-size: 13px;
  }

  .form input:focus {
    outline: none;
    border-color: var(--accent-color, #0096c8);
  }

  .error {
    font-size: 11px;
    color: var(--error-color, #f44);
    padding: 4px 0;
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

  .btn-primary:hover {
    opacity: 0.9;
  }

  .btn-secondary:hover {
    background: var(--bg-hover, #2a2a2a);
  }
</style>
