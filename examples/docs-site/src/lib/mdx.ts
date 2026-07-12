/**
 * Real MDX for authored bodies in Astro — the sdk-astro "MDX pipeline story".
 *
 * Bodies are stored as source strings in content_index (git wins; FTS still
 * searches prose). At render time we evaluate the MDX with the project's
 * React component map and render it to static HTML in the .astro frontmatter
 * (async is allowed there), so registry blocks are real JSX with zero client
 * JS — the Astro-native equivalent of sdk-next's <MdxBody />.
 *
 * Code blocks are highlighted by shiki with both themes emitted as CSS
 * variables; global.css composes them with light-dark(), so highlighting
 * follows the same theme mechanism as every other color on the site.
 *
 * Usage in a page:
 * ```astro
 * ---
 * const html = await renderMdx(doc.body);
 * ---
 * <article set:html={html} />
 * ```
 */
import rehypeShiki from "@shikijs/rehype";
import { evaluate } from "@mdx-js/mdx";
import type { MDXComponents } from "mdx/types";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as runtime from "react/jsx-runtime";
import remarkGfm from "remark-gfm";
import { mdxComponents } from "../components/mdx";

export type MdxComponents = MDXComponents;

/** Evaluate an MDX source string and render it to static HTML. */
export async function renderMdx(source: string, components?: MdxComponents): Promise<string> {
  const trimmed = source.trim();
  if (trimmed.length === 0) return "";

  const { default: Content } = await evaluate(trimmed, {
    ...runtime,
    remarkPlugins: [remarkGfm],
    rehypePlugins: [
      [
        rehypeShiki,
        {
          // Vitesse's green-leaning palette sits naturally on the graft
          // greens; both themes ship as CSS vars (defaultColor: false) and
          // light-dark() picks the live one.
          themes: { light: "vitesse-light", dark: "vitesse-dark" },
          defaultColor: false,
        },
      ],
    ],
    development: false,
  });

  return renderToStaticMarkup(
    createElement(Content, { components: { ...mdxComponents, ...components } }),
  );
}
