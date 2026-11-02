<script lang="ts">
  import { MdxContent } from "@usegraft/sdk-sveltekit/mdx";
  import Callout from "../../lib/Callout.svelte";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();
</script>

<main>
  <h1>{data.page.data.title}</h1>
  <p>{data.page.data.summary}</p>
  <div class="body"><MdxContent tree={data.body} components={{ Callout }} /></div>
  <a id="to-about" href="/about">About</a>
</main>
