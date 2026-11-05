/**
 * @usegraft/sdk-tanstack-start/server: turn an MDX body into the tree
 * `MdxContent` (from `@usegraft/sdk-tanstack-start/mdx`) renders.
 *
 * The body is never compiled to code or run: `prepareMdx` parses it into
 * plain JSON that travels from the server to the page in TanStack Start's own data.
 * Expressions, imports and scripting are refused under every trust level.
 * Call it where only the server runs, beside `createGraft`.
 */
export {
  prepareMdx,
  type MdxNode,
  type MdxPropValue,
  type MdxTree,
  type MdxTrust,
  type PrepareMdxOptions,
} from "@usegraft/mdx-safety/prepare";
