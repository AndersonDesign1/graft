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
import { assertSafeMdx } from "@usegraft/mdx-safety";
import type { MDXComponents } from "mdx/types";
import type { ReactElement } from "react";
import * as runtime from "react/jsx-runtime";
import remarkGfm from "remark-gfm";

export type MdxComponents = MDXComponents;

export type MdxTrust = "restricted" | "full";

export interface MdxBodyProps {
  /** Raw MDX body (the string stored on the document / content_index row). */
  source: string;
  /** Component map — typically the generated mdx-components export. */
  components?: MdxComponents;
  /**
   * How much of MDX this body is allowed to be. Defaults to `"restricted"`.
   *
   * `run()` evaluates the compiled body with `new Function` in this process, so
   * `{expr}` and `import` are arbitrary server-side JavaScript. That is fine
   * for content the operator wrote and reviewed in git, and not fine for
   * content written through the API — where "can author a page" would
   * otherwise mean "can execute code on the render host".
   *
   * `"restricted"` refuses executable constructs before compiling. Pass
   * `"full"` only for bodies you know came from your own repository.
   */
  trust?: MdxTrust;
}

/**
 * Compile + run an MDX source string and render it with the given components.
 * Empty source renders nothing (valid for body-less docs).
 */
export async function MdxBody({
  source,
  components,
  trust = "restricted",
}: MdxBodyProps): Promise<ReactElement | null> {
  const trimmed = source.trim();
  if (trimmed.length === 0) return null;

  // Checked at render as well as at write, because content can also arrive
  // through a direct database write with the runtime credential — a path no
  // write-side guard sees.
  if (trust !== "full") assertSafeMdx(trimmed);

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
