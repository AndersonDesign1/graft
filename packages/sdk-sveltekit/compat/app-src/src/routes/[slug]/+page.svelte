<script lang="ts">
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();
</script>

<main>
  <h1>{data.page.data.title}</h1>
  <p>{data.page.data.summary}</p>
  <a id="to-about" href="/about">About</a>
</main>
