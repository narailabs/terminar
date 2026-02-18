<script lang="ts">
  import { api, type TrayConfig } from "./lib/api";

  let config = $state<TrayConfig>({
    gateway_port: 6749,
    tls_mode: "auto",
    tls_cert: null,
    tls_key: null,
    tls_port: 8444,
    require_auth: true,
    audit_level: "standard",
    idle_timeout: 1800,
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

  async function pickCert() {
    const path = await api.pickFile({
      title: "Select TLS Certificate",
      filters: [{ name: "PEM", extensions: ["pem", "crt"] }],
    });
    if (path) config.tls_cert = path;
  }

  async function pickKey() {
    const path = await api.pickFile({
      title: "Select TLS Private Key",
      filters: [{ name: "PEM", extensions: ["pem", "key"] }],
    });
    if (path) config.tls_key = path;
  }

  async function save() {
    saving = true;
    errorMessage = "";
    try {
      await api.saveConfig(config);
      const restart = await api.ask("Restart service to apply changes?", {
        title: "Restart Required",
        kind: "info",
      });
      if (restart) {
        await api.restartService();
      }
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

  async function uninstall() {
    const confirmed = await api.confirm(
      "This will stop and remove the terminar gateway service. Are you sure?",
      { title: "Uninstall Service", kind: "warning" },
    );
    if (confirmed) {
      try {
        await api.uninstallService();
        api.closeWindow();
      } catch (e) {
        errorMessage = `Uninstall failed: ${e}`;
      }
    }
  }

  // Idle timeout display: store as seconds, show as minutes
  let idleMinutes = $derived(Math.round(config.idle_timeout / 60));
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
      <h2>Network</h2>
      <div class="field">
        <label for="gateway-port">Gateway Port</label>
        <input
          id="gateway-port"
          type="number"
          bind:value={config.gateway_port}
          min="1"
          max="65535"
        />
      </div>
      <div class="field">
        <label for="tls-port">TLS Port</label>
        <input
          id="tls-port"
          type="number"
          bind:value={config.tls_port}
          min="1"
          max="65535"
        />
      </div>
    </section>

    <section>
      <h2>Security</h2>
      <div class="field">
        <label for="tls-mode">TLS Mode</label>
        <select id="tls-mode" bind:value={config.tls_mode}>
          <option value="off">Off</option>
          <option value="auto">Auto (Self-Signed)</option>
          <option value="custom">Custom Certificate</option>
        </select>
      </div>

      {#if config.tls_mode === "custom"}
        <div class="field">
          <label>Certificate</label>
          <div class="file-picker">
            <span class="path">{config.tls_cert ?? "None"}</span>
            <button class="small" onclick={pickCert}>Browse</button>
          </div>
        </div>
        <div class="field">
          <label>Private Key</label>
          <div class="file-picker">
            <span class="path">{config.tls_key ?? "None"}</span>
            <button class="small" onclick={pickKey}>Browse</button>
          </div>
        </div>
      {/if}

      <div class="field row">
        <label for="require-auth">Require Authentication</label>
        <input
          id="require-auth"
          type="checkbox"
          bind:checked={config.require_auth}
        />
      </div>

      <div class="field">
        <label for="audit-level">Audit Level</label>
        <select id="audit-level" bind:value={config.audit_level}>
          <option value="off">Off</option>
          <option value="auth">Auth Only</option>
          <option value="standard">Standard</option>
          <option value="verbose">Verbose</option>
        </select>
      </div>
    </section>

    <section>
      <h2>Service</h2>
      <div class="field">
        <label for="idle-timeout">Idle Timeout (minutes)</label>
        <input
          id="idle-timeout"
          type="number"
          value={idleMinutes}
          oninput={(e: Event) => {
            const target = e.target as HTMLInputElement;
            config.idle_timeout = parseInt(target.value) * 60;
          }}
          min="1"
          max="1440"
        />
      </div>
      <button class="danger" onclick={uninstall}>Uninstall Service</button>
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

  .field.row {
    flex-direction: row;
    align-items: center;
    gap: 0.5rem;
  }

  .field.row label {
    flex: 1;
  }

  label {
    font-size: 0.85rem;
    color: #cdd6f4;
  }

  input[type="number"],
  select {
    background: #313244;
    border: 1px solid #45475a;
    border-radius: 4px;
    color: #cdd6f4;
    padding: 0.4rem 0.5rem;
    font-size: 0.9rem;
  }

  input[type="checkbox"] {
    width: 18px;
    height: 18px;
    accent-color: #89b4fa;
  }

  .file-picker {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .path {
    flex: 1;
    font-size: 0.8rem;
    color: #a6adc8;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    background: #313244;
    border: 1px solid #45475a;
    border-radius: 4px;
    padding: 0.35rem 0.5rem;
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

  .small {
    background: #45475a;
    color: #cdd6f4;
    padding: 0.3rem 0.75rem;
    font-size: 0.8rem;
  }

  .small:hover {
    background: #585b70;
  }

  .danger {
    background: rgba(243, 139, 168, 0.15);
    color: #f38ba8;
    border: 1px solid #f38ba8;
    margin-top: 0.5rem;
  }

  .danger:hover {
    background: rgba(243, 139, 168, 0.25);
  }
</style>
