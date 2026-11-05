import type { MdxTree, MdxTrust } from "@usegraft/mdx-safety/prepare";

export type { MdxNode, MdxTree } from "@usegraft/mdx-safety/prepare";

export interface MdxContentProps {
  /** The document's MDX body, such as `doc.body`. */
  source?: string;
  /** A tree `prepareMdx` already prepared, instead of `source`. */
  tree?: MdxTree;
  /** Astro components the body names, such as `{ Callout }`. */
  components?: Record<string, unknown>;
  /** "restricted" (the default) keeps only relative, http, https, mailto and tel URLs. */
  trust?: MdxTrust;
  /** What is being rendered, for error messages, such as "posts/hello". */
  label?: string;
}

/**
 * Render a document's MDX body. Pass `source={doc.body}`; it is prepared on
 * the server and never evaluated.
 */
// Typed as Astro types every `.astro` module, which is what this re-exports.
export declare function MdxContent(props: MdxContentProps): any;
