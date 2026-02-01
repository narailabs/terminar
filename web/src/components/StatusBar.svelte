<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { ConnectionState } from '../lib/SessionManager';
  import { settingsStore } from '../lib/settingsStore';

  export let sessionName: string = '';
  export let shellType: string = '';
  export let connectionState: ConnectionState = 'disconnected';
  export let sessionCount: number = 0;
  export let cwd: string = '';
  export let startedAt: string = '';

  let showStatusBar = true;
  const unsubSettings = settingsStore.subscribe((s) => {
    showStatusBar = s.showStatusBar;
  });

  // Uptime tracking
  let uptime = '0:00:00';
  let uptimeInterval: ReturnType<typeof setInterval> | null = null;

  function formatUptime(startIso: string): string {
    if (!startIso) return '0:00:00';
    const start = new Date(startIso).getTime();
    const now = Date.now();
    const diffMs = Math.max(0, now - start);
    const totalSeconds = Math.floor(diffMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function updateUptime() {
    uptime = formatUptime(startedAt);
  }

  // Reactively restart the interval when startedAt changes
  $: {
    if (uptimeInterval) {
      clearInterval(uptimeInterval);
      uptimeInterval = null;
    }
    if (startedAt) {
      updateUptime();
      uptimeInterval = setInterval(updateUptime, 1000);
    } else {
      uptime = '0:00:00';
    }
  }

  function connectionText(state: ConnectionState): string {
    switch (state) {
      case 'connected': return 'Connected';
      case 'connecting': return 'Connecting...';
      case 'reconnecting': return 'Reconnecting...';
      case 'disconnected': return 'Disconnected';
      default: return 'Unknown';
    }
  }

  function connectionDotClass(state: ConnectionState): string {
    switch (state) {
      case 'connected': return 'connected';
      case 'connecting':
      case 'reconnecting': return 'connecting';
      case 'disconnected': return 'disconnected';
      default: return '';
    }
  }

  $: hasSession = sessionName !== '';
  $: sessionCountText = sessionCount === 1 ? '1 session' : `${sessionCount} sessions`;

  onDestroy(() => {
    if (uptimeInterval) {
      clearInterval(uptimeInterval);
    }
    unsubSettings();
  });
</script>

{#if showStatusBar}
  <div class="status-bar-bottom">
    {#if hasSession}
      <div class="status-section">
        <span class="status-shell">{shellType}</span>
      </div>
      <div class="status-section status-session-name">
        <span>{sessionName}</span>
      </div>
      <div class="status-section status-cwd">
        <span>{cwd}</span>
      </div>
    {:else}
      <div class="status-section">
        <span class="status-no-session">No session</span>
      </div>
    {/if}
    <div class="status-spacer"></div>
    <div class="status-section">
      <span class="status-dot {connectionDotClass(connectionState)}"></span>
      <span>{connectionText(connectionState)}</span>
    </div>
    <div class="status-section">
      <span>{sessionCountText}</span>
    </div>
    {#if hasSession}
      <div class="status-section">
        <span class="status-uptime">{uptime}</span>
      </div>
    {/if}
  </div>
{/if}

<style>
  .status-bar-bottom {
    display: flex;
    align-items: center;
    height: 22px;
    padding: 0 8px;
    background: var(--ui-accent, #0e639c);
    color: var(--ui-text-primary, #ffffff);
    font-size: 12px;
    flex-shrink: 0;
    gap: 0;
    user-select: none;
  }

  .status-section {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 8px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .status-section + .status-section {
    border-left: 1px solid rgba(255, 255, 255, 0.2);
  }

  .status-spacer {
    flex: 1;
  }

  .status-spacer + .status-section {
    border-left: none;
  }

  .status-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .status-dot.connected {
    background: #4caf50;
  }

  .status-dot.connecting {
    background: #ff9800;
    animation: pulse 1.5s ease-in-out infinite;
  }

  .status-dot.disconnected {
    background: #f44336;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .status-shell {
    font-weight: 600;
  }

  .status-cwd {
    max-width: 300px;
  }

  .status-no-session {
    color: rgba(255, 255, 255, 0.6);
    font-style: italic;
  }

  .status-uptime {
    font-variant-numeric: tabular-nums;
  }
</style>
