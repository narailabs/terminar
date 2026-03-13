<script lang="ts">
  import Settings from "./Settings.svelte";
  import WslInstallGuide from "./WslInstallGuide.svelte";

  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode") ?? "settings";
</script>

<main>
  {#if mode === "wsl-guide"}
    <WslInstallGuide />
  {:else}
    <Settings />
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
    min-height: 100vh;
  }
</style>
