/**
 * MdxBody — real MDX evaluation for authored content bodies.
 *
 * Authored `*.mdx` files keep their body as a source string in content_index
 * (git wins; FTS still searches prose). At render time this compiles + runs
 * the MDX with the project's component map so registry blocks (`Callout`,
 * `Faq`, …) are real JSX — not react-markdown fakes.
 *
 * Server Components only (async evaluate). Pass components from the generated
 * `components/mdx-components.ts` map that `graft add` regenerates.
 */
import { compile, run } from "@mdx-js/mdx";
import type { MDXComponents } from "mdx/types";
import type { ReactElement } from "react";
import * as runtime from "react/jsx-runtime";
import remarkGfm from "remark-gfm";

export type MdxComponents = MDXComponents;

export interface MdxBodyProps {
  /** Raw MDX body (the string stored on the document / content_index row). */
  source: string;
  /** Component map — typically the generated mdx-components export. */
  components?: MdxComponents;
}

/**
 * Compile + run an MDX source string and render it with the given components.
 * Empty source renders nothing (valid for body-less docs).
 */
export async function MdxBody({ source, components }: MdxBodyProps): Promise<ReactElement | null> {
  const trimmed = source.trim();
  if (trimmed.length === 0) return null;

  const compiled = String(
    await compile(trimmed, {
      outputFormat: "function-body",
      remarkPlugins: [remarkGfm],
      development: process.env.NODE_ENV !== "production",
    }),
  );

  const { default: Content } = await run(compiled, {
    ...runtime,
    baseUrl: import.meta.url,
  });

  return <Content components={components ?? {}} />;
}
