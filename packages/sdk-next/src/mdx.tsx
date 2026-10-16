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
import { rehypeSafeUrls } from "./safe-urls";

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
async function compileMdx(
  source: string,
  options: { trust: MdxTrust; development: boolean; forBrowser?: boolean },
): Promise<string> {
  const restricted = options.trust !== "full";
  // Checked at render as well as at write, because content can also arrive
  // through a direct database write with the runtime credential — a path no
  // write-side guard sees.
  if (restricted) assertSafeMdx(source);
  return String(
    await compile(source, {
      outputFormat: "function-body",
      remarkPlugins: options.forBrowser ? [remarkGfm, remarkRefuseModules] : [remarkGfm],
      rehypePlugins: restricted ? [rehypeSafeUrls] : [],
      development: options.development,
    }),
  );
}

/**
 * Whether a parsed MDX tree loads a module: `import`, `export … from`,
 * `import()` or `import.meta`. Read from the syntax tree, so a code span or a
 * fenced block that only mentions one is prose, not an import.
 */
function loadsModules(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(loadsModules);
  if (!value || typeof value !== "object") return false;
  if ("type" in value) {
    const node: { type?: unknown; source?: unknown; meta?: { name?: unknown } } = value;
    if (node.type === "ImportDeclaration" || node.type === "ImportExpression") return true;
    if (node.type === "MetaProperty" && node.meta?.name === "import") return true;
    if (
      (node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration") &&
      node.source
    )
      return true;
  }
  return Object.entries(value).some(([key, child]) => key !== "position" && loadsModules(child));
}

/** Refuses a body that loads modules, which the browser has no bundler to resolve. */
function remarkRefuseModules() {
  return (tree: unknown) => {
    if (!loadsModules(tree)) return;
    throw new GraftError({
      code: "INPUT_VALIDATION_FAILED",
      message: "This MDX body imports modules, which prepareMdx can't send to the browser.",
      fix: "Pass the components in MdxContent's components map instead of importing them in the MDX. In the App Router, MdxBody runs imports on the server.",
      details: { reason: "mdx-import" },
    });
  };
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

  const compiled = await compileMdx(trimmed, {
    trust,
    development: process.env.NODE_ENV !== "production",
  });
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
  return compileMdx(trimmed, {
    trust: options.trust ?? "restricted",
    development: false,
    forBrowser: true,
  });
}
