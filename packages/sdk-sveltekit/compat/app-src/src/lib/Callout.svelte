<script lang="ts">
  import type { Snippet } from "svelte";

  let { type = "note", children }: { type?: string; children?: Snippet } = $props();
</script>

<aside class="callout callout-{type}">{@render children?.()}</aside>
