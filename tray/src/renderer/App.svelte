<script lang="ts">
  import Settings from "./Settings.svelte";
</script>

<main>
  <Settings />
</main>

<style>
  :global(body) {
    margin: 0;
    font-family: 'Space Grotesk', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
      "Helvetica Neue", Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
    background: #0d0e10;
    color: #fdfbfe;
  }

  main {
    min-height: 100vh;
  }
</style>
