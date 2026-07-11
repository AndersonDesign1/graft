/**
 * Real MDX for authored bodies in Astro — the sdk-astro "MDX pipeline story".
 *
 * Bodies are stored as source strings in content_index (git wins; FTS still
 * searches prose). At render time we evaluate the MDX with the project's
 * React component map and render it to static HTML in the .astro frontmatter
 * (async is allowed there), so registry blocks are real JSX with zero client
 * JS — the Astro-native equivalent of sdk-next's <MdxBody />.
 *
 * Usage in a page:
 * ```astro
 * ---
 * const html = await renderMdx(doc.body);
 * ---
 * <article set:html={html} />
 * ```
 */
import { evaluate } from "@mdx-js/mdx";
import type { MDXComponents } from "mdx/types";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as runtime from "react/jsx-runtime";
import remarkGfm from "remark-gfm";

export type MdxComponents = MDXComponents;

/** Evaluate an MDX source string and render it to static HTML. */
export async function renderMdx(source: string, components?: MdxComponents): Promise<string> {
  const trimmed = source.trim();
  if (trimmed.length === 0) return "";

  const { default: Content } = await evaluate(trimmed, {
    ...runtime,
    remarkPlugins: [remarkGfm],
    development: false,
  });

  return renderToStaticMarkup(createElement(Content, { components: components ?? {} }));
}
