<script lang="ts">
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();
</script>

<ul>
  {#each data.pages as page (page.slug)}
    <li><a href="/{page.slug}">{page.title}</a></li>
  {/each}
</ul>
<p>hits:{data.hits.join(",")}</p>
