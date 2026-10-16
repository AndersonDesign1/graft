/**
 * The one way Graft reads frontmatter.
 *
 * gray-matter picks its parser from the text after the opening `---`, and for
 * `---js` (or `---javascript`) it runs the block through `eval`. A document
 * is input from whoever can save one: a contributor in Studio, an agent over
 * MCP, a pull request. So YAML and JSON are read, and any other language is
 * refused before gray-matter can pick an engine for it. The engines that run
 * code are also replaced, in case its language detection ever disagrees.
 */
import { GraftError } from "@usegraft/contracts";
import matter from "gray-matter";

export interface Frontmatter {
  data: Record<string, unknown>;
  /** The body after the closing `---`. */
  content: string;
}

const ACCEPTED = new Set(["", "yaml", "yml", "json"]);

/** The details of a refusal, for a caller that wants the file and the language. */
export type FrontmatterRefusal = {
  reason: "frontmatter-language";
  language: string;
  sourcePath?: string;
};

function refused(language: string, source: string | undefined): GraftError {
  const details: FrontmatterRefusal = { reason: "frontmatter-language", language };
  if (source) details.sourcePath = source;
  return new GraftError({
    code: "INPUT_VALIDATION_FAILED",
    message: `The frontmatter${source ? ` in ${source}` : ""} is written in "${language}". Graft reads YAML frontmatter, or JSON.`,
    fix: "Open the file with a line that is just ---, and write the frontmatter as YAML.",
    details,
  });
}

/**
 * Parse a document's frontmatter and body. Throws INPUT_VALIDATION_FAILED,
 * naming `source`, for frontmatter in a language that can run code, and
 * gray-matter's own error for YAML that does not parse. Never caches: gray-matter's cache is keyed
 * by the whole file and would keep every version of every document.
 */
export function readFrontmatter(raw: string, source?: string): Frontmatter {
  if (matter.test(raw)) {
    const language = matter.language(raw).name.toLowerCase();
    if (!ACCEPTED.has(language)) throw refused(language, source);
  }
  const refuse = (language: string) => () => {
    throw refused(language, source);
  };
  const parsed = matter(raw, {
    engines: { javascript: refuse("javascript"), coffee: refuse("coffee") },
  });
  const data: Record<string, unknown> =
    parsed.data && typeof parsed.data === "object" ? parsed.data : {};
  return { data, content: parsed.content };
}

/**
 * A body and its data back into a file, with YAML frontmatter written by
 * js-yaml's safeDump. `lineWidth: -1` keeps long strings on one line.
 */
export function writeFrontmatter(
  body: string,
  data: Record<string, unknown>,
  yaml: { lineWidth?: number } = {},
): string {
  // SAFETY: gray-matter hands these options to js-yaml's safeDump unchanged,
  // and lineWidth is a safeDump option its types do not list.
  return matter.stringify(body, data, yaml as matter.GrayMatterOption<string, never>);
}
