<script lang="ts">
  import ConnectionStatus from './ConnectionStatus.svelte';
  import type { ConnectionState } from '../lib/SessionManager';
  import { broadcastEnabled, clearTargets } from '../lib/broadcastStore.svelte';

  let {
    connectionState,
    reconnectAttempt,
    reconnectDelay,
    isLocalEchoMode,
    isLocal,
    onReconnect,
    onLogout,
    onSettings,
    onToggleBroadcast,
  }: {
    connectionState: ConnectionState;
    reconnectAttempt: number;
    reconnectDelay: number;
    isLocalEchoMode: boolean;
    isLocal: boolean;
    onReconnect: () => void;
    onLogout: () => void;
    onSettings: () => void;
    onToggleBroadcast: () => void;
  } = $props();

  // Shortcuts popup state
  let showShortcutsPopup = $state(false);
  let shortcutsTimeout: ReturnType<typeof setTimeout> | null = null;

  function toggleShortcuts() {
    if (shortcutsTimeout) {
      clearTimeout(shortcutsTimeout);
      shortcutsTimeout = null;
    }
    showShortcutsPopup = !showShortcutsPopup;
    if (showShortcutsPopup) {
      // Auto-close after 8 seconds
      shortcutsTimeout = setTimeout(() => {
        showShortcutsPopup = false;
        shortcutsTimeout = null;
      }, 8000);
      // Close on outside click
      setTimeout(() => {
        window.addEventListener('click', closeShortcutsOnOutsideClick, { once: true, capture: true });
      });
    }
  }

  function closeShortcutsOnOutsideClick(e: MouseEvent) {
    const wrapper = (e.target as HTMLElement)?.closest('.shortcuts-wrapper');
    if (!wrapper) {
      showShortcutsPopup = false;
      if (shortcutsTimeout) {
        clearTimeout(shortcutsTimeout);
        shortcutsTimeout = null;
      }
    } else {
      // Click was inside wrapper, re-register
      setTimeout(() => {
        window.addEventListener('click', closeShortcutsOnOutsideClick, { once: true, capture: true });
      });
    }
  }
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
    <div class="shortcuts-wrapper">
      <button
        class="shortcuts-btn"
        onclick={toggleShortcuts}
        title="Keyboard Shortcuts"
        aria-label="Show keyboard shortcuts"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M1 4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4zm1 0v8h12V4H2zm1.5 1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-1 0v-1a.5.5 0 0 1 .5-.5zm2 0a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-1 0v-1a.5.5 0 0 1 .5-.5zm2 0a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-1 0v-1a.5.5 0 0 1 .5-.5zm2 0a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-1 0v-1a.5.5 0 0 1 .5-.5zm2 0a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-1 0v-1a.5.5 0 0 1 .5-.5zM3.5 8a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-1 0v-1a.5.5 0 0 1 .5-.5zm8 0a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-1 0v-1a.5.5 0 0 1 .5-.5zm-6 0h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1 0-1z"/>
        </svg>
      </button>
      {#if showShortcutsPopup}
        <div class="shortcuts-popup">
          <div class="shortcuts-title">Keyboard Shortcuts</div>
          <div class="shortcut-row"><kbd>Ctrl/Cmd+F</kbd> <span>Search in terminal</span></div>
          <div class="shortcut-row"><kbd>Escape</kbd> <span>Close search</span></div>
          <div class="shortcut-row"><kbd>Cmd+B</kbd> <span>Toggle sidebar</span></div>
          <div class="shortcut-row"><kbd>Cmd+Shift+N</kbd> <span>New terminal</span></div>
          <div class="shortcut-row"><kbd>Cmd+T</kbd> <span>New tab</span></div>
          <div class="shortcut-row"><kbd>Cmd+W</kbd> <span>Close pane</span></div>
          <div class="shortcut-row"><kbd>Ctrl+Shift+H</kbd> <span>Split horizontal</span></div>
          <div class="shortcut-row"><kbd>Ctrl+Shift+V</kbd> <span>Split vertical</span></div>
          <div class="shortcut-row"><kbd>Cmd+1-9</kbd> <span>Switch tab</span></div>
        </div>
      {/if}
    </div>
    <button
      class="broadcast-btn"
      class:active={broadcastEnabled.value}
      onclick={onToggleBroadcast}
      title="Broadcast Mode"
      aria-label="Toggle broadcast mode"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 1a.5.5 0 0 1 .5.5v1.527A6.5 6.5 0 0 1 14.5 9.5a.5.5 0 0 1-1 0 5.5 5.5 0 0 0-5-5.478V5.5a.5.5 0 0 1-1 0V4.022A5.5 5.5 0 0 0 2.5 9.5a.5.5 0 0 1-1 0A6.5 6.5 0 0 1 7.5 3.027V1.5A.5.5 0 0 1 8 1zM5.5 9.5a2.5 2.5 0 1 1 5 0 2.5 2.5 0 0 1-5 0zm1 0a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0zM4 9.5a4 4 0 0 1 4-4 .5.5 0 0 1 0 1 3 3 0 0 0-3 3 .5.5 0 0 1-1 0zm7 0a3 3 0 0 0-3-3 .5.5 0 0 1 0-1 4 4 0 0 1 4 4 .5.5 0 0 1-1 0z"/>
      </svg>
    </button>
    {#if !isLocal}
      <button
        class="logout-btn"
        onclick={onLogout}
        title="Logout"
        aria-label="Logout and disconnect"
      >Logout</button>
    {/if}
    <button
      class="settings-btn"
      onclick={onSettings}
      title="Terminal Settings"
      aria-label="Open terminal settings"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path fill-rule="evenodd" clip-rule="evenodd" d="M9.1 4.4L8.6 2H7.4L6.9 4.4L6.5 4.6L4.4 3.5L3.5 4.4L4.6 6.5L4.4 6.9L2 7.4V8.6L4.4 9.1L4.6 9.5L3.5 11.6L4.4 12.5L6.5 11.4L6.9 11.6L7.4 14H8.6L9.1 11.6L9.5 11.4L11.6 12.5L12.5 11.6L11.4 9.5L11.6 9.1L14 8.6V7.4L11.6 6.9L11.4 6.5L12.5 4.4L11.6 3.5L9.5 4.6L9.1 4.4ZM8 10C9.1046 10 10 9.1046 10 8C10 6.8954 9.1046 6 8 6C6.8954 6 6 6.8954 6 8C6 9.1046 6.8954 10 8 10Z"/>
      </svg>
    </button>
  </div>
</div>

<style>
  .status-bar {
    zoom: var(--controls-zoom, 1);
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

  .shortcuts-wrapper {
    position: relative;
  }

  .shortcuts-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: var(--ui-text-muted, #757578);
    cursor: pointer;
    transition: all 0.15s;
  }

  .shortcuts-btn:hover {
    background: var(--ui-bg-tertiary, #242629);
    color: var(--ui-text-primary, #fdfbfe);
  }

  .shortcuts-popup {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 6px;
    background: var(--ui-bg-secondary, #181a1c);
    border: 1px solid var(--ui-border, #47484a);
    border-radius: 6px;
    padding: 10px 14px;
    min-width: 240px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    z-index: 1000;
    animation: fadeIn 0.15s ease-out;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .shortcuts-title {
    font-size: 11px;
    font-weight: 600;
    color: var(--ui-text-secondary, #aaa);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 8px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--ui-border, #47484a);
  }

  .shortcut-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 3px 0;
    font-size: 12px;
    color: var(--ui-text-primary, #fdfbfe);
  }

  .shortcut-row kbd {
    font-family: inherit;
    font-size: 11px;
    color: var(--ui-text-primary, #ddd);
    background: var(--ui-bg-tertiary, #242629);
    border: 1px solid var(--ui-border, #505050);
    border-radius: 3px;
    padding: 1px 6px;
    min-width: 0;
  }

  .shortcut-row span {
    color: var(--ui-text-muted, #757578);
    margin-left: 16px;
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

  .broadcast-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: var(--ui-text-muted, #757578);
    cursor: pointer;
    transition: all 0.15s;
  }

  .broadcast-btn:hover {
    background: var(--ui-bg-tertiary, #242629);
    color: var(--ui-text-primary, #fdfbfe);
  }

  .broadcast-btn.active {
    color: var(--ui-accent, #a0a7ff);
    background: rgba(14, 99, 156, 0.15);
  }

  .settings-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: var(--ui-text-muted, #757578);
    cursor: pointer;
    transition: all 0.15s;
  }

  .settings-btn:hover {
    background: var(--ui-bg-tertiary, #242629);
    color: var(--ui-text-primary, #fdfbfe);
  }

  .settings-btn:active {
    background: var(--ui-bg-tertiary, #454545);
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
