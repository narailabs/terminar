<script lang="ts">
  import ConnectionStatus from './ConnectionStatus.svelte';
  import type { ConnectionState } from '../lib/SessionManager';
  let {
    connectionState,
    reconnectAttempt,
    reconnectDelay,
    isLocalEchoMode,
    isLocal,
    onReconnect,
    onLogout,
  }: {
    connectionState: ConnectionState;
    reconnectAttempt: number;
    reconnectDelay: number;
    isLocalEchoMode: boolean;
    isLocal: boolean;
    onReconnect: () => void;
    onLogout: () => void;
  } = $props();
</script>

<div class="status-bar">
  {#if isLocalEchoMode}
    <div class="local-echo-badge">
      <span class="badge-dot"></span>
      LOCAL PTY MODE - Main Server Bypassed
    </div>
  {:else if connectionState !== 'connected'}
    <ConnectionStatus
      state={connectionState}
      {reconnectAttempt}
      {reconnectDelay}
      onReconnect={onReconnect}
    />
  {/if}
  <div class="status-bar-right">
    {#if !isLocal}
      <button
        class="logout-btn"
        onclick={onLogout}
        title="Logout"
        aria-label="Logout and disconnect"
      >Logout</button>
    {/if}
    <h3 class="app-title">terminar</h3>
  </div>
</div>

<style>
  .status-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 12px;
    background: var(--ui-bg-primary, #0d0e10);
    border-bottom: 1px solid var(--ui-border, #47484a);
    flex-shrink: 0;
  }

  .status-bar-right {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .app-title {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    letter-spacing: 0.5px;
    color: var(--ui-text-primary, #fdfbfe);
  }

  .logout-btn {
    padding: 4px 10px;
    background: transparent;
    border: 1px solid var(--ui-border, #555);
    border-radius: 4px;
    color: var(--ui-text-muted, #757578);
    cursor: pointer;
    font-size: 12px;
    transition: all 0.15s;
  }

  .logout-btn:hover {
    background: var(--ui-bg-tertiary, #242629);
    color: var(--ui-destructive, #ff6b6b);
    border-color: var(--ui-destructive, #ff6b6b);
  }

  .local-echo-badge {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 12px;
    background: #3a3d41;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    color: #e5c07b;
    letter-spacing: 0.5px;
  }

  .badge-dot {
    width: 8px;
    height: 8px;
    background: #e5c07b;
    border-radius: 50%;
    animation: pulse 2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
</style>
