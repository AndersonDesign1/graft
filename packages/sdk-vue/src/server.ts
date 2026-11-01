/**
 * @usegraft/sdk-vue/server: compile an MDX body on the server for `MdxContent`.
 *
 * Its own entry so the MDX compiler never reaches a browser bundle. Call it
 * where only the server runs: a Nuxt server route, or a Vite SSR server.
 */
import { compile } from "@mdx-js/mdx";
import {
  assertSafeMdx,
  rehypeSafeUrls,
  remarkRefuseModules,
  type MdxTrust,
} from "@usegraft/mdx-safety";
import remarkGfm from "remark-gfm";

export type { MdxTrust };

export interface PrepareMdxOptions {
  /**
   * How much of MDX this body is allowed to be. Defaults to `"restricted"`,
   * which refuses `{expr}`, `import`, `export`, scripting elements and event
   * handlers before compiling, and drops `javascript:` and other script URLs.
   * Vue renders those URLs as they are, so this matters more here than in
   * React 19. Pass `"full"` only for bodies you know came from your own
   * repository, and match `mdxTrust` in graft.config.ts.
   */
  trust?: MdxTrust;
}

/**
 * Compile an MDX body to the string `MdxContent` renders. Empty source gives
 * "". A body that imports modules is refused: the browser runs the result
 * without a bundler, so components come through MdxContent's `components`.
 */
export async function prepareMdx(source: string, options: PrepareMdxOptions = {}): Promise<string> {
  const trimmed = source.trim();
  if (trimmed.length === 0) return "";
  const restricted = (options.trust ?? "restricted") !== "full";
  // Checked at render as well as at write, because content can also arrive
  // through a direct database write that no write-side guard sees.
  if (restricted) assertSafeMdx(trimmed);
  return String(
    await compile(trimmed, {
      outputFormat: "function-body",
      remarkPlugins: [remarkGfm, remarkRefuseModules],
      rehypePlugins: restricted ? [rehypeSafeUrls] : [],
      development: false,
    }),
  );
}
