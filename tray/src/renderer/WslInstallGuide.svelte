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
    color: #ababad;
    margin: 1rem 0 0.5rem;
    font-weight: 600;
  }

  .description {
    font-size: 0.9rem;
    line-height: 1.5;
    color: #ababad;
    margin-bottom: 1rem;
  }

  .code-block {
    background: #181a1c;
    border: 1px solid #47484a;
    border-radius: 6px;
    padding: 0.75rem 1rem;
    font-family: "Cascadia Code", "Consolas", monospace;
    font-size: 0.9rem;
    color: #23d18b;
    margin: 0.5rem 0;
    user-select: all;
  }

  .note {
    font-size: 0.8rem;
    color: #ababad;
    margin-top: 0.5rem;
  }

  .warning {
    background: rgba(229, 192, 123, 0.15);
    border: 1px solid #e5c07b;
    border-radius: 4px;
    padding: 0.5rem;
    color: #e5c07b;
    font-size: 0.85rem;
    margin: 1rem 0;
  }

  .error {
    background: rgba(255, 110, 132, 0.15);
    border: 1px solid #ff6e84;
    border-radius: 4px;
    padding: 0.5rem;
    color: #ff6e84;
    font-size: 0.85rem;
    margin: 1rem 0;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 1rem;
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

  .link {
    color: #a0a7ff;
    font-size: 0.85rem;
    text-decoration: none;
  }

  .link:hover {
    text-decoration: underline;
  }
</style>
