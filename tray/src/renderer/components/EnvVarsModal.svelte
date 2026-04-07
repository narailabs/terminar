<script lang="ts">
  import { onMount } from 'svelte';
  import EnvVarEditor from './EnvVarEditor.svelte';
  import { readSessionList, type SessionSummary } from '../lib/sessionListStore.svelte';
  import {
    globalEnvVars,
    addEnvVar,
    updateEnvVar,
    deleteEnvVar,
    sessionEnvVars,
    addSessionEnvVar,
    updateSessionEnvVar,
    deleteSessionEnvVar,
    getSessionEnvVars,
  } from '../lib/envStore.svelte';

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  let sessions = $state<SessionSummary[]>([]);
  let selectedScope = $state<'global' | string>('global');

  onMount(() => {
    sessions = readSessionList();
  });

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose();
    }
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }

  function getSelectedVars(): Record<string, string> {
    if (selectedScope === 'global') {
      return globalEnvVars.value;
    }
    return getSessionEnvVars(selectedScope);
  }

  function handleAdd(key: string, value: string) {
    if (selectedScope === 'global') {
      addEnvVar(key, value);
    } else {
      addSessionEnvVar(selectedScope, key, value);
    }
  }

  function handleUpdate(key: string, value: string) {
    if (selectedScope === 'global') {
      updateEnvVar(key, value);
    } else {
      updateSessionEnvVar(selectedScope, key, value);
    }
  }

  function handleDelete(key: string) {
    if (selectedScope === 'global') {
      deleteEnvVar(key);
    } else {
      deleteSessionEnvVar(selectedScope, key);
    }
  }

  function getScopeLabel(): string {
    if (selectedScope === 'global') return 'Global';
    const session = sessions.find(s => s.id === selectedScope);
    return session?.name || selectedScope.slice(0, 8);
  }

  function getSessionDisplayName(session: SessionSummary): string {
    return session.name || session.id.slice(0, 8);
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="backdrop" role="dialog" onkeydown={handleKeyDown} onclick={handleBackdropClick}>
  <div class="modal">
    <div class="modal-header">
      <h2>Environment Variables</h2>
      <button class="close-btn" onclick={onClose} title="Close">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>
    </div>

    <div class="modal-body">
      <nav class="scope-nav">
        <button
          class="nav-item"
          class:active={selectedScope === 'global'}
          onclick={() => selectedScope = 'global'}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.2"/>
            <path d="M2 7h10M7 2c-1.5 1.5-2.2 3.2-2.2 5s.7 3.5 2.2 5c1.5-1.5 2.2-3.2 2.2-5s-.7-3.5-2.2-5" stroke="currentColor" stroke-width="1.2"/>
          </svg>
          Global
        </button>

        {#if sessions.length > 0}
          <div class="nav-divider"></div>
          <div class="nav-label">Terminals</div>
          {#each sessions as session (session.id)}
            <button
              class="nav-item"
              class:active={selectedScope === session.id}
              onclick={() => selectedScope = session.id}
              title={session.name || session.id}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <rect x="1.5" y="2.5" width="11" height="9" rx="1.5" stroke="currentColor" stroke-width="1.2"/>
                <path d="M4 6l2 1.5L4 9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M7.5 9H10" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
              </svg>
              <span class="nav-item-text">{getSessionDisplayName(session)}</span>
              {#if Object.keys(getSessionEnvVars(session.id)).length > 0}
                <span class="badge">{Object.keys(getSessionEnvVars(session.id)).length}</span>
              {/if}
            </button>
          {/each}
        {/if}
      </nav>

      <div class="editor-panel">
        {#key selectedScope}
          <EnvVarEditor
            vars={getSelectedVars()}
            onAdd={handleAdd}
            onUpdate={handleUpdate}
            onDelete={handleDelete}
            scopeLabel={getScopeLabel()}
          />
        {/key}
      </div>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 1100;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .modal {
    background: #1e1f22;
    border: 1px solid #47484a;
    border-radius: 10px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
    width: min(700px, 90vw);
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid #242629;
    flex-shrink: 0;
  }

  h2 {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 600;
    color: #fdfbfe;
  }

  .close-btn {
    background: none;
    border: none;
    color: #6c7086;
    cursor: pointer;
    padding: 0.25rem;
    border-radius: 4px;
    display: flex;
    align-items: center;
  }

  .close-btn:hover {
    color: #fdfbfe;
    background: #242629;
  }

  .modal-body {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .scope-nav {
    width: 180px;
    flex-shrink: 0;
    border-right: 1px solid #242629;
    padding: 0.5rem;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.6rem;
    border: none;
    border-radius: 6px;
    background: none;
    color: #a6adc8;
    font-size: 0.8rem;
    cursor: pointer;
    text-align: left;
    width: 100%;
    white-space: nowrap;
    overflow: hidden;
  }

  .nav-item:hover {
    background: #242629;
    color: #fdfbfe;
  }

  .nav-item.active {
    background: rgba(160, 167, 255, 0.15);
    color: #a0a7ff;
  }

  .nav-item svg {
    flex-shrink: 0;
  }

  .nav-item-text {
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
  }

  .badge {
    background: #47484a;
    color: #a6adc8;
    font-size: 0.65rem;
    padding: 0.1rem 0.35rem;
    border-radius: 8px;
    flex-shrink: 0;
  }

  .nav-divider {
    height: 1px;
    background: #242629;
    margin: 0.35rem 0;
  }

  .nav-label {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #6c7086;
    padding: 0.2rem 0.6rem;
  }

  .editor-panel {
    flex: 1;
    padding: 0.75rem 1rem;
    min-width: 0;
    overflow-y: auto;
  }
</style>
