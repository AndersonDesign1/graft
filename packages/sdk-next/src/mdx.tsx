/**
 * MdxBody — real MDX evaluation for authored content bodies.
 *
 * Authored `*.mdx` files keep their body as a source string in content_index
 * (git wins; FTS still searches prose). At render time this compiles + runs
 * the MDX with the project's component map so registry blocks (`Callout`,
 * `Faq`, …) are real JSX — not react-markdown fakes.
 *
 * MdxBody is an async Server Component, for the App Router. The Pages Router
 * compiles with prepareMdx in getStaticProps and renders with MdxContent from
 * `@usegraft/sdk-next/mdx`. Pass components from the generated
 * `components/mdx-components.ts` map that `graft add` regenerates.
 */
import { compile, run } from "@mdx-js/mdx";
import { GraftError } from "@usegraft/contracts";
import { assertSafeMdx, type MdxTrust } from "@usegraft/mdx-safety";
import type { MDXComponents } from "mdx/types";
import type { ReactElement } from "react";
import * as runtime from "react/jsx-runtime";
import remarkGfm from "remark-gfm";

export type MdxComponents = MDXComponents;

export type { MdxTrust };

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
   *
   * `graft compile` applies the same rule to the authored tree, from
   * `mdxTrust` in graft.config.ts. The two have to agree: a project that sets
   * `mdxTrust = "full"` and leaves this at the default indexes bodies that then
   * fail to render.
   */
  trust?: MdxTrust;
}

/** Check a body against its trust rule and compile it to a function body. */
async function compileMdx(source: string, trust: MdxTrust, development: boolean): Promise<string> {
  // Checked at render as well as at write, because content can also arrive
  // through a direct database write with the runtime credential — a path no
  // write-side guard sees.
  if (trust !== "full") assertSafeMdx(source);
  return String(
    await compile(source, {
      outputFormat: "function-body",
      remarkPlugins: [remarkGfm],
      development,
    }),
  );
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

  const compiled = await compileMdx(trimmed, trust, process.env.NODE_ENV !== "production");
  const { default: Content } = await run(compiled, {
    ...runtime,
    baseUrl: import.meta.url,
  });

  return <Content components={components ?? {}} />;
}

/**
 * Compile an MDX body for the Pages Router: call it in getStaticProps or
 * getServerSideProps, pass the string in props, and render it with
 * MdxContent from `@usegraft/sdk-next/mdx`. Empty source gives "".
 *
 * The same trust rule as MdxBody applies, here on the server. A body that
 * imports modules is refused: the browser runs the result without a bundler,
 * so components come through MdxContent's `components` instead.
 */
export async function prepareMdx(
  source: string,
  options: { trust?: MdxTrust } = {},
): Promise<string> {
  const trimmed = source.trim();
  if (trimmed.length === 0) return "";
  // Production JSX always: the browser gets react/jsx-runtime, not the dev one.
  const compiled = await compileMdx(trimmed, options.trust ?? "restricted", false);
  if (compiled.includes("await import(")) {
    throw new GraftError({
      code: "INPUT_VALIDATION_FAILED",
      message: "This MDX body imports modules, which prepareMdx can't send to the browser.",
      fix: "Pass the components in MdxContent's components map instead of importing them in the MDX. In the App Router, MdxBody runs imports on the server.",
      details: { reason: "mdx-import" },
    });
  }
  return compiled;
}
