/**
 * @usegraft/sdk-sveltekit/server: turn an MDX body into the tree
 * `MdxContent` (from `@usegraft/sdk-sveltekit/mdx`) renders.
 *
 * Svelte has no JSX runtime, so the body is never compiled to code or run.
 * `prepareMdx` parses it into plain JSON that travels from a server `load`
 * to the page in SvelteKit's own data. Expressions, imports and scripting are
 * refused under every trust level. Call it where only the server runs: a
 * `+page.server.ts` load or a `+server.ts` route.
 *
 * The same `prepareMdx` serves every framework's MdxContent; it lives in
 * `@usegraft/mdx-safety/prepare`.
 */
export {
  prepareMdx,
  type MdxNode,
  type MdxPropValue,
  type MdxTree,
  type MdxTrust,
  type PrepareMdxOptions,
} from "@usegraft/mdx-safety/prepare";
