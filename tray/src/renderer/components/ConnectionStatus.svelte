<script lang="ts">
  import type { ConnectionState } from '../lib/SessionManager';

  let { state, reconnectAttempt = 0, reconnectDelay = 0, onReconnect = undefined }: {
    state: ConnectionState;
    reconnectAttempt?: number;
    reconnectDelay?: number;
    onReconnect?: (() => void) | undefined;
  } = $props();

  let statusText = $derived(getStatusText(state, reconnectAttempt, reconnectDelay));
  let statusClass = $derived(getStatusClass(state));
  let showReconnectButton = $derived(state === 'disconnected' && onReconnect);

  function getStatusText(s: ConnectionState, attempt: number, delay: number): string {
    switch (s) {
      case 'connecting':
        return 'Connecting...';
      case 'connected':
        return 'Connected';
      case 'reconnecting':
        return `Reconnecting in ${Math.ceil(delay / 1000)}s (attempt ${attempt})...`;
      case 'disconnected':
        return 'Disconnected';
      default:
        return 'Unknown';
    }
  }

  function getStatusClass(s: ConnectionState): string {
    switch (s) {
      case 'connecting':
      case 'reconnecting':
        return 'status-connecting';
      case 'connected':
        return 'status-connected';
      case 'disconnected':
        return 'status-disconnected';
      default:
        return '';
    }
  }
</script>

<div class="connection-status {statusClass}">
  <div class="status-indicator"></div>
  <span class="status-text">{statusText}</span>
  {#if showReconnectButton}
    <button class="reconnect-button" onclick={onReconnect}>
      Reconnect
    </button>
  {/if}
</div>

<style>
  .connection-status {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: 4px;
    font-size: 14px;
    background: rgba(0, 0, 0, 0.3);
  }

  .status-indicator {
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }

  .status-connected .status-indicator {
    background: #4caf50;
    box-shadow: 0 0 6px rgba(76, 175, 80, 0.6);
  }

  .status-connecting .status-indicator {
    background: #ff9800;
    animation: pulse 1.5s ease-in-out infinite;
  }

  .status-disconnected .status-indicator {
    background: #f44336;
  }

  @keyframes pulse {
    0%, 100% {
      opacity: 1;
    }
    50% {
      opacity: 0.4;
    }
  }

  .status-text {
    color: var(--ui-text-primary, #fdfbfe);
  }

  .reconnect-button {
    padding: 4px 12px;
    margin-left: 8px;
    background: var(--ui-bg-secondary, #333);
    color: var(--ui-text-primary, white);
    border: 1px solid var(--ui-bg-tertiary, #555);
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
  }

  .reconnect-button:hover {
    background: var(--ui-bg-tertiary, #444);
  }
</style>
