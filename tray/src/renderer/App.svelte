<script lang="ts">
  import Settings from "./Settings.svelte";
</script>

<main>
  <Settings />
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
