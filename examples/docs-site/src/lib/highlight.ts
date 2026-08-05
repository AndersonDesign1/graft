/**
 * Terminal highlighting — the same shiki instance, themes, and dual-theme CSS
 * variables the docs code blocks use (see lib/mdx.ts), so the landing terminal
 * and a fenced ```console block in the docs are colored by one highlighter
 * rather than two hand-maintained palettes that drift apart.
 *
 * Theme: GitHub (github-light / github-dark). Vercel’s own code blocks use the
 * same pair — there is no separate “Vercel” Shiki theme to chase.
 *
 * The landing terminal types itself out, so it cannot consume shiki's HTML.
 * Instead we tokenize at build time (Astro frontmatter) and hand the island a
 * serializable line/token tree it can reveal progressively. Zero shiki on the
 * client — the tokens are just strings and inline styles.
 */
import { codeToTokens } from "shiki";

/** Single source for landing + docs Shiki dual themes. */
export const SHIKI_THEMES = {
  light: "github-light",
  dark: "github-dark",
} as const;

/**
 * GitHub dual-theme CSS vars (same hexes Shiki emits for github-*).
 * Used to enrich console output lines the grammar paints flat.
 */
const GH = {
  fg: ["#24292E", "#E1E4E8"],
  comment: ["#6A737D", "#8B949E"],
  string: ["#032F62", "#9ECBFF"],
  keyword: ["#D73A49", "#F97583"],
  entity: ["#6F42C1", "#B392F0"],
  constant: ["#005CC5", "#79B8FF"],
  inserted: ["#22863A", "#85E89D"],
  deleted: ["#B31D28", "#F97583"],
  warning: ["#E36209", "#FFAB70"],
} as const;

function ghStyle(pair: readonly [string, string]): string {
  return `--shiki-light:${pair[0]};--shiki-dark:${pair[1]}`;
}

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

/** Split a CLI stats line like `+1 added  ~1 changed  −0 removed` into hues. */
function paintStatsLine(text: string): TermToken[] {
  const parts = text.split(/(\+\d+\s+added|~\d+\s+changed|[−-]\d+\s+removed)/g);
  return parts
    .filter((p) => p.length > 0)
    .map((part) => {
      if (/^\+\d+/.test(part.trim())) return { c: part, s: ghStyle(GH.inserted) };
      if (/^~\d+/.test(part.trim())) return { c: part, s: ghStyle(GH.warning) };
      if (/^[−-]\d+/.test(part.trim())) return { c: part, s: ghStyle(GH.deleted) };
      return { c: part, s: ghStyle(GH.comment) };
    });
}

/**
 * Console grammars paint most output one flat blue. Re-tint success / stats /
 * comments so the stage CLI reads like a real colored terminal (and matches
 * the branching hand-painted lines).
 */
function enrichConsoleLine(text: string, tokens: TermToken[]): TermToken[] {
  const trimmed = text.trimStart();
  if (!trimmed) return tokens;

  // Commands: keep Shiki, but ensure `$` / comments get a clear hue when flat.
  if (trimmed.startsWith("$")) {
    if (trimmed.startsWith("$ #") || trimmed.includes(" # ")) {
      const hash = text.indexOf("#");
      if (hash === -1) return tokens;
      return [
        { c: text.slice(0, hash), s: ghStyle(GH.fg) },
        { c: text.slice(hash), s: ghStyle(GH.comment) },
      ];
    }
    return tokens;
  }

  if (/\+\d+\s+added|[~]\d+\s+changed|[−-]\d+\s+removed/.test(text)) {
    return paintStatsLine(text);
  }

  if (/validated|created|projected|compiled|✓/.test(text)) {
    return [{ c: text, s: ghStyle(GH.inserted) }];
  }

  if (/error|failed|refused/i.test(text)) {
    return [{ c: text, s: ghStyle(GH.deleted) }];
  }

  // Paths / meta output — GitHub string blue
  return [{ c: text, s: ghStyle(GH.string) }];
}

/**
 * Tokenize a shell session (or a code snippet — pass `lang`). Console lines
 * that start with a prompt are "typed"; their output is printed. In other
 * languages every line is a command — the whole snippet types out. Blank
 * lines are kept so the transcript breathes.
 */
export async function highlightSession(
  source: string,
  lang: "console" | "ts" | "sql" | "json" = "console",
): Promise<TermLine[]> {
  const { tokens } = await codeToTokens(source.trim(), {
    lang,
    themes: SHIKI_THEMES,
    defaultColor: false,
  });

  return tokens.map((line) => {
    const text = line.map((t) => t.content).join("");
    const typed = lang !== "console" || text.trimStart().startsWith("$");
    const raw = line.map((t) => ({ c: t.content, s: styleOf(t) }));
    return {
      typed,
      pause: typed ? 420 : 90,
      tokens: lang === "console" ? enrichConsoleLine(text, raw) : raw,
    };
  });
}

/**
 * The wow loop, verbatim from what @graft/cli actually prints — split across
 * the two places it is told. The hero shows the graft taking (`init`); the
 * stage shows the loop running (`compile`). Together they are one transcript,
 * so neither surface repeats the other.
 */
export const HERO_INIT = `
$ pnpm graft init
  created graft.config.ts
  created content/pages/home.mdx
  created llms.txt

$ # your repo is now the CMS
`;

export const STAGE_COMPILE = `
$ pnpm graft compile
  pages/home     validated ✓
  pages/pricing  validated ✓
  projected to content_index @ 9f31c2e
  +1 added  ~1 changed  −0 removed

$ # that was the entire publish
`;
