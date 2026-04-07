<script lang="ts">
  import { api, type TrayConfig } from "./lib/api";
  import EnvVarsModal from "./components/EnvVarsModal.svelte";

  let config = $state<TrayConfig>({
    server_port: 6750,
  });

  let loading = $state(true);
  let saving = $state(false);
  let errorMessage = $state("");
  let showEnvModal = $state(false);

  // Load config on mount
  $effect(() => {
    loadConfig();
  });

  async function loadConfig() {
    try {
      const loaded = await api.getConfig();
      config = loaded;
    } catch (e) {
      errorMessage = `Failed to load config: ${e}`;
    } finally {
      loading = false;
    }
  }

  async function save() {
    saving = true;
    errorMessage = "";
    try {
      await api.saveConfig(config);
      api.closeWindow();
    } catch (e) {
      errorMessage = `Failed to save: ${e}`;
    } finally {
      saving = false;
    }
  }

  function cancel() {
    api.closeWindow();
  }
</script>

{#if loading}
  <div class="loading">Loading...</div>
{:else}
  <div class="settings">
    <h1>Settings</h1>

    {#if errorMessage}
      <div class="error">{errorMessage}</div>
    {/if}

    <section>
      <h2>Server</h2>
      <div class="field">
        <label for="server-port">Server Port</label>
        <input
          id="server-port"
          type="number"
          bind:value={config.server_port}
          min="1"
          max="65535"
        />
      </div>
    </section>

    <section>
      <h2>Environment</h2>
      <div class="field">
        <button class="env-button" onclick={() => showEnvModal = true}>
          Environment Variables
        </button>
        <span class="field-hint">Set environment variables for terminal sessions</span>
      </div>
    </section>

    {#if showEnvModal}
      <EnvVarsModal onClose={() => showEnvModal = false} />
    {/if}

    <div class="actions">
      <button class="secondary" onclick={cancel}>Cancel</button>
      <button class="primary" onclick={save} disabled={saving}>
        {saving ? "Saving..." : "Save"}
      </button>
    </div>
  </div>
{/if}

<style>
  .settings {
    padding: 1.25rem;
    max-width: 480px;
    margin: 0 auto;
  }

  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
    color: #a6adc8;
  }

  h1 {
    font-size: 1.25rem;
    margin: 0 0 1rem;
    font-weight: 600;
  }

  h2 {
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #a6adc8;
    margin: 1rem 0 0.5rem;
    font-weight: 600;
  }

  section {
    margin-bottom: 0.5rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-bottom: 0.75rem;
  }

  label {
    font-size: 0.85rem;
    color: #fdfbfe;
  }

  input[type="number"] {
    background: #181a1c;
    border: 1px solid #47484a;
    border-radius: 4px;
    color: #fdfbfe;
    padding: 0.4rem 0.5rem;
    font-size: 0.9rem;
  }

  .error {
    background: rgba(255, 110, 132, 0.15);
    border: 1px solid #ff6e84;
    border-radius: 4px;
    padding: 0.5rem;
    color: #ff6e84;
    font-size: 0.85rem;
    margin-bottom: 1rem;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 1.5rem;
    padding-top: 1rem;
    border-top: 1px solid #242629;
  }

  button {
    border: none;
    border-radius: 6px;
    padding: 0.5rem 1.25rem;
    font-size: 0.9rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s;
  }

  .primary {
    background: #a0a7ff;
    color: #0d0e10;
  }

  .primary:hover {
    background: #8f97ff;
  }

  .primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .secondary {
    background: #242629;
    color: #fdfbfe;
  }

  .secondary:hover {
    background: #47484a;
  }

  .env-button {
    background: #242629;
    color: #fdfbfe;
    width: 100%;
    text-align: left;
    border: 1px solid #47484a;
    border-radius: 6px;
    padding: 0.5rem 0.75rem;
    font-size: 0.9rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s;
  }

  .env-button:hover {
    background: #2e3035;
    border-color: #a0a7ff;
  }

  .field-hint {
    font-size: 0.75rem;
    color: #6c7086;
  }
</style>
