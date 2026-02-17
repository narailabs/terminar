<script lang="ts">
  import { getCurrentWindow } from "@tauri-apps/api/window";

  // The mode is passed as a query parameter from the Rust backend
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode") ?? "settings";
</script>

<main>
  {#if mode === "install"}
    <p>Install view (coming soon)</p>
  {:else}
    <p>Settings view (coming soon)</p>
  {/if}
</main>

<style>
  :global(body) {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
      "Helvetica Neue", Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
    background: #1e1e2e;
    color: #cdd6f4;
  }

  main {
    padding: 1.5rem;
  }
</style>
