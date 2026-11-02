<script lang="ts">
  // A tree that did not come from prepareMdx, as if stored and edited by hand.
  // MdxContent must still put no script, handler or raw HTML on the page.
  import { MdxContent, type MdxTree } from "@usegraft/sdk-sveltekit/mdx";

  const tree: MdxTree = [
    { type: "element", tag: "script", props: {}, children: [{ type: "text", value: "window.pwned = 1" }] },
    {
      type: "element",
      tag: "p",
      props: { onclick: "window.pwned = 1", innerHTML: "<b>raw</b>", class: "kept" },
      children: [{ type: "text", value: "Safe text." }],
    },
  ];
</script>

<main><MdxContent {tree} /></main>
