<script lang="ts">
  import { api } from "./lib/api";

  let status = $state<"idle" | "installing" | "success" | "error">("idle");
  let errorMessage = $state("");

  async function install() {
    status = "installing";
    errorMessage = "";

    try {
      // Load default config
      const config = await api.getConfig();
      // Install the service with default config
      await api.installService(config);
      status = "success";
      // Close window after a brief delay
      setTimeout(() => {
        api.closeWindow();
      }, 1500);
    } catch (e) {
      status = "error";
      errorMessage = e instanceof Error ? e.message : String(e);
    }
  }
</script>

<div class="container">
  <h1>Install termiNar Gateway</h1>

  {#if status === "idle"}
    <p class="description">
      termiNar will install a system service that manages your terminal
      sessions. This requires administrator privileges.
    </p>
    <p class="detail">
      The service will be configured with auto-TLS, authentication, and
      standard audit logging. You can change these settings later from the tray
      menu.
    </p>
    <button class="primary" onclick={install}>Install</button>
  {:else if status === "installing"}
    <div class="status">
      <div class="spinner"></div>
      <p>Installing gateway service...</p>
      <p class="detail">You may be prompted for your administrator password.</p>
    </div>
  {:else if status === "success"}
    <div class="status success">
      <p>Gateway service installed successfully!</p>
      <p class="detail">The service is now running.</p>
    </div>
  {:else if status === "error"}
    <div class="status error">
      <p>Installation failed</p>
      <p class="detail">{errorMessage}</p>
      <button class="primary" onclick={install}>Retry</button>
    </div>
  {/if}
</div>

<style>
  .container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 280px;
    text-align: center;
    padding: 1.5rem;
  }

  h1 {
    font-size: 1.3rem;
    margin: 0 0 1rem;
    font-weight: 600;
  }

  .description {
    font-size: 0.95rem;
    line-height: 1.5;
    margin: 0 0 0.5rem;
    color: #cdd6f4;
  }

  .detail {
    font-size: 0.85rem;
    color: #a6adc8;
    margin: 0.25rem 0 1.5rem;
    line-height: 1.4;
  }

  .primary {
    background: #89b4fa;
    color: #1e1e2e;
    border: none;
    border-radius: 6px;
    padding: 0.6rem 2rem;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
  }

  .primary:hover {
    background: #74c7ec;
  }

  .status {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
  }

  .status p {
    margin: 0;
  }

  .success p:first-child {
    color: #a6e3a1;
    font-weight: 600;
  }

  .error p:first-child {
    color: #f38ba8;
    font-weight: 600;
  }

  .spinner {
    width: 32px;
    height: 32px;
    border: 3px solid #313244;
    border-top-color: #89b4fa;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin-bottom: 0.5rem;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
