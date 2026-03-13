<script lang="ts">
  import { api, type TrayConfig } from "./lib/api";

  let config = $state<TrayConfig>({
    shell: null,
    log_level: "info",
  });

  let loading = $state(true);
  let saving = $state(false);
  let errorMessage = $state("");

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
      <h2>General</h2>
      <div class="field">
        <label for="shell">Shell</label>
        <input
          id="shell"
          type="text"
          bind:value={config.shell}
          placeholder="Default system shell"
        />
      </div>
      <div class="field">
        <label for="log-level">Log Level</label>
        <select id="log-level" bind:value={config.log_level}>
          <option value="error">Error</option>
          <option value="warn">Warn</option>
          <option value="info">Info</option>
          <option value="debug">Debug</option>
          <option value="trace">Trace</option>
        </select>
      </div>
    </section>

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
    color: #cdd6f4;
  }

  input[type="text"],
  select {
    background: #313244;
    border: 1px solid #45475a;
    border-radius: 4px;
    color: #cdd6f4;
    padding: 0.4rem 0.5rem;
    font-size: 0.9rem;
  }

  .error {
    background: rgba(243, 139, 168, 0.15);
    border: 1px solid #f38ba8;
    border-radius: 4px;
    padding: 0.5rem;
    color: #f38ba8;
    font-size: 0.85rem;
    margin-bottom: 1rem;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 1.5rem;
    padding-top: 1rem;
    border-top: 1px solid #313244;
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
    background: #89b4fa;
    color: #1e1e2e;
  }

  .primary:hover {
    background: #74c7ec;
  }

  .primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .secondary {
    background: #45475a;
    color: #cdd6f4;
  }

  .secondary:hover {
    background: #585b70;
  }
</style>
