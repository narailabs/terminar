<script lang="ts">
  import { api } from "./lib/api";

  let checking = $state(false);
  let status = $state<{ installed: boolean; hasDistro: boolean; distro: string | null } | null>(null);
  let errorMessage = $state("");

  async function checkWsl() {
    checking = true;
    errorMessage = "";
    try {
      const result = await api.checkWsl();
      status = result;
      if (result.installed && result.hasDistro) {
        // WSL is ready -- restart the server
        await api.startServer();
        api.closeWindow();
      }
    } catch (e) {
      errorMessage = `Failed to check WSL status: ${e}`;
    } finally {
      checking = false;
    }
  }
</script>

<div class="guide">
  <h1>WSL Required</h1>

  <p class="description">
    terminar requires the <strong>Windows Subsystem for Linux (WSL)</strong> to
    run its server component. WSL lets you run Linux programs directly on
    Windows without a virtual machine.
  </p>

  <section>
    <h2>Install WSL</h2>
    <p>Open <strong>PowerShell as Administrator</strong> and run:</p>
    <div class="code-block">
      <code>wsl --install</code>
    </div>
    <p class="note">
      This will install WSL with the default Ubuntu distribution. You may need
      to restart your computer after installation.
    </p>
  </section>

  {#if status && !status.installed}
    <div class="warning">
      WSL is not installed yet. Please run the install command above and restart
      your computer if prompted.
    </div>
  {:else if status && !status.hasDistro}
    <div class="warning">
      WSL is installed but no Linux distribution was found. Run
      <code>wsl --install</code> to install the default Ubuntu distribution.
    </div>
  {/if}

  {#if errorMessage}
    <div class="error">{errorMessage}</div>
  {/if}

  <div class="actions">
    <button class="primary" onclick={checkWsl} disabled={checking}>
      {checking ? "Checking..." : "Check Again"}
    </button>
    <a
      class="link"
      href="https://learn.microsoft.com/en-us/windows/wsl/install"
      target="_blank"
      rel="noopener noreferrer"
    >
      Microsoft WSL Documentation
    </a>
  </div>
</div>

<style>
  .guide {
    padding: 1.25rem;
    max-width: 480px;
    margin: 0 auto;
  }

  h1 {
    font-size: 1.25rem;
    margin: 0 0 0.75rem;
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

  .description {
    font-size: 0.9rem;
    line-height: 1.5;
    color: #bac2de;
    margin-bottom: 1rem;
  }

  .code-block {
    background: #313244;
    border: 1px solid #45475a;
    border-radius: 6px;
    padding: 0.75rem 1rem;
    font-family: "Cascadia Code", "Consolas", monospace;
    font-size: 0.9rem;
    color: #a6e3a1;
    margin: 0.5rem 0;
    user-select: all;
  }

  .note {
    font-size: 0.8rem;
    color: #a6adc8;
    margin-top: 0.5rem;
  }

  .warning {
    background: rgba(249, 226, 175, 0.15);
    border: 1px solid #f9e2af;
    border-radius: 4px;
    padding: 0.5rem;
    color: #f9e2af;
    font-size: 0.85rem;
    margin: 1rem 0;
  }

  .error {
    background: rgba(243, 139, 168, 0.15);
    border: 1px solid #f38ba8;
    border-radius: 4px;
    padding: 0.5rem;
    color: #f38ba8;
    font-size: 0.85rem;
    margin: 1rem 0;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 1rem;
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

  .link {
    color: #89b4fa;
    font-size: 0.85rem;
    text-decoration: none;
  }

  .link:hover {
    text-decoration: underline;
  }
</style>
