<!--
  MdxContent: render a body that `prepareMdx` (from
  `@usegraft/sdk-sveltekit/server`) prepared on the server.

  The tree is plain JSON, so it renders the same on the server and when the
  page hydrates, with nothing but Svelte. Nothing in it is evaluated: text is
  text, HTML elements are elements, and a component the body names renders
  only if `components` has it under that name. One it lacks renders its
  content without the wrapper.

  Pass a tree from `prepareMdx`, which checks the body. As a second line,
  this drops `<script>`-like elements, `on…` handlers and `innerHTML`-style
  attributes from any tree it is given, but it does not filter URLs: a tree
  built from untrusted input elsewhere can still carry a `javascript:` link.
-->
<script>
  import MdxNodes from "./MdxNodes.svelte";

  /** @type {{ tree: import("../server.js").MdxTree, components?: Record<string, import("svelte").Component<any>> }} */
  let { tree, components = {} } = $props();
</script>

<MdxNodes nodes={tree} {components} />
