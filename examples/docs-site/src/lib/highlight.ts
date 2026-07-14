/**
 * Terminal highlighting — the same shiki instance, themes, and dual-theme CSS
 * variables the docs code blocks use (see lib/mdx.ts), so the landing terminal
 * and a fenced ```console block in the docs are colored by one highlighter
 * rather than two hand-maintained palettes that drift apart.
 *
 * The landing terminal types itself out, so it cannot consume shiki's HTML.
 * Instead we tokenize at build time (Astro frontmatter) and hand the island a
 * serializable line/token tree it can reveal progressively. Zero shiki on the
 * client — the tokens are just strings and inline styles.
 */
import { codeToTokens } from "shiki";

export interface TermToken {
  /** token text */
  c: string;
  /** inline style carrying --shiki-light / --shiki-dark */
  s: string;
}

export interface TermLine {
  /** typed out character by character (a command) vs printed at once (output) */
  typed: boolean;
  /** ms to hold after this line completes */
  pause: number;
  tokens: TermToken[];
}

/** shiki's htmlStyle is an object in v3+, a string in older builds. */
function styleOf(token: { htmlStyle?: string | Record<string, string> }): string {
  const style = token.htmlStyle;
  if (!style) return "";
  if (typeof style === "string") return style;
  return Object.entries(style)
    .map(([key, value]) => `${key}:${value}`)
    .join(";");
}

/**
 * Tokenize a shell session. Lines that start with a prompt are "typed"; their
 * output is printed. Blank lines are kept so the transcript breathes.
 */
export async function highlightSession(source: string): Promise<TermLine[]> {
  const { tokens } = await codeToTokens(source.trim(), {
    lang: "console",
    themes: { light: "min-light", dark: "min-dark" },
    defaultColor: false,
  });

  return tokens.map((line) => {
    const text = line.map((t) => t.content).join("");
    const typed = text.trimStart().startsWith("$");
    return {
      typed,
      pause: typed ? 420 : 90,
      tokens: line.map((t) => ({ c: t.content, s: styleOf(t) })),
    };
  });
}

/** The wow loop, verbatim from what @graft/cli actually prints. */
export const WOW_LOOP = `
$ pnpm graft init
  created graft.config.ts
  created content/pages/home.mdx
  created llms.txt

$ pnpm graft compile
  pages/home  validated ✓
  projected to content_index @ 9f31c2e
  +1 added  ~0 changed  −0 removed

$ # that was the entire publish
`;
