<!--
  One level of a prepared tree, rendering itself for each node's children.
  Kept on single lines: whitespace between these tags would become text in
  the page, and inside <pre> it would show.
-->
<script>
  import MdxNodes from "./MdxNodes.svelte";
  import { renderable, safeProps } from "@usegraft/mdx-safety/tree";

  /** @type {{ nodes: import("../server.js").MdxTree, components: Record<string, import("svelte").Component<any>> }} */
  let { nodes, components } = $props();
</script>

{#each nodes as node}{#if node.type === "text"}{node.value}{:else if node.type === "element"}{#if !renderable(node.tag)}{:else if node.children.length > 0}<svelte:element this={node.tag} {...safeProps(node.props)}><MdxNodes nodes={node.children} {components} /></svelte:element>{:else}<svelte:element this={node.tag} {...safeProps(node.props)} />{/if}{:else if Object.hasOwn(components, node.name)}{@const Custom = components[node.name]}{#if node.children.length > 0}<Custom {...safeProps(node.props)}><MdxNodes nodes={node.children} {components} /></Custom>{:else}<Custom {...safeProps(node.props)} />{/if}{:else}<MdxNodes nodes={node.children} {components} />{/if}{/each}
