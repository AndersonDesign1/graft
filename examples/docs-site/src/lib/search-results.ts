/**
 * Turn Postgres FTS hits into the SortedResult[] fumadocs' fetch client wants.
 *
 * Three jobs, none of which the SDK can do for us:
 *
 * 1. `ts_headline` wraps matched terms in <b>…</b>. Fumadocs 16 renders a
 *    result's `content` as Markdown (rehype-raw, allowDangerousHtml) and marks
 *    matches with <mark>, so the translation is <b> to <mark> — but everything
 *    around it has to be escaped first, or an authored <Callout> in a snippet
 *    renders as an element instead of as the text the author wrote.
 * 2. Headings become their own results. Searching an error code should land on
 *    that code's section, not at the top of a 42-section page.
 * 3. The snippet is anchored to the heading it was found under, so a hit deep
 *    in a long page opens where the words are.
 *
 * Heading ids are generated with the same github-slugger that rehype-slug uses
 * in lib/mdx.ts, reset per document and walked in document order, because that
 * is the only way the id here matches the id in the rendered page.
 */
import GithubSlugger from "github-slugger";

export interface SortedResult {
  id: string;
  url: string;
  type: "page" | "heading" | "text";
  content: string;
}

/** The fields of a SearchHit this module needs. */
export interface SearchSourceHit {
  slug: string;
  title: string;
  /** Authored MDX source, as stored in content_index. */
  body: string;
  /** ts_headline fragments with matches wrapped in <b>…</b>. */
  snippet: string;
}

export interface DocHeading {
  depth: number;
  /** Heading text with inline markdown removed, as rehype-slug would see it. */
  text: string;
  /** The `id` attribute rehype-slug puts on the rendered heading. */
  id: string;
  /** Index into the body where this heading's line starts. */
  offset: number;
}

const ATX_HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;
const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})/;

/**
 * Strip the inline markdown rehype-slug never sees, because it slugs the
 * heading's rendered text. Deliberately narrow: code spans, asterisk emphasis,
 * link and image syntax.
 *
 * Underscore emphasis is excluded on purpose. `_italic_` in a heading is rare
 * and costs an unstyled word when missed, while snake_case identifiers are
 * everywhere in these docs and a greedy match turns "graft_add then
 * graft_compile" into "graftadd then graftcompile" — an id that matches no
 * anchor on the page. CommonMark does not emphasise intraword underscores
 * either, so skipping them is also the more correct reading. The editor's MDX
 * tokenizer refuses `_emphasis_` for the same reason (see L2.2).
 */
function toPlainText(heading: string): string {
  return heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // [text](url) and ![alt](src)
    .replace(/!?\[([^\]]*)\]\[[^\]]*\]/g, "$1") // [text][ref]
    .replace(/`+([^`]+)`+/g, "$1") // `code`
    .replace(/\*\*(.+?)\*\*/g, "$1") // **bold**
    .replace(/\*(?=\S)(.+?)(?<=\S)\*/g, "$1") // *italic*
    .replace(/\\([!-/:-@[-`{-~])/g, "$1") // backslash escapes
    .trim();
}

/**
 * Every ATX heading in an MDX body, in document order, with the id it will
 * carry once rendered. Fenced code is skipped: a `## ` line inside a shell
 * block is a comment, and linking to it would produce an anchor that does not
 * exist on the page.
 */
export function extractHeadings(body: string): DocHeading[] {
  const slugger = new GithubSlugger();
  const headings: DocHeading[] = [];
  let offset = 0;
  let fence: string | undefined;

  for (const raw of body.split("\n")) {
    const lineStart = offset;
    offset += raw.length + 1;
    // Authored files are whatever the author's editor writes, and three of
    // these docs are CRLF. Splitting on \n leaves the \r on every line, where
    // it defeats an end-anchored heading match silently — the file simply
    // reports no headings at all.
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;

    const fenceMatch = FENCE.exec(line);
    if (fence === undefined) {
      if (fenceMatch) {
        fence = fenceMatch[1][0];
        continue;
      }
    } else {
      // A closing fence is the same character, at least as long, nothing after.
      if (fenceMatch && fenceMatch[1][0] === fence && line.trim() === fenceMatch[1]) {
        fence = undefined;
      }
      continue;
    }

    const match = ATX_HEADING.exec(line);
    if (!match) continue;

    const text = toPlainText(match[2]);
    if (text === "") continue;

    headings.push({
      depth: match[1].length,
      text,
      id: slugger.slug(text),
      offset: lineStart,
    });
  }

  return headings;
}

const MARKDOWN_PUNCTUATION = /[\\`*_[\]<>&#]/g;
/**
 * A block that can only open at the start of a line, which here means index 0.
 * Split so the escape lands on punctuation: CommonMark honours a backslash
 * only before ASCII punctuation, so `\1.` renders as a literal backslash and
 * `1\.` is the one that renders as the digit the author wrote.
 */
const LEADING_BLOCK = /^(\d{1,9})?([-+.)])(?=\s)/;

/**
 * Escape a run of snippet text so it renders as the bytes the author wrote.
 * Fumadocs parses `content` as Markdown with raw HTML enabled, so both layers
 * have to be neutralised: HTML entities for the angle brackets and ampersand,
 * backslashes for the inline markdown punctuation CommonMark honours.
 *
 * `#` is in the set because a ts_headline fragment can begin at a heading, and
 * the start of the string is a line start like any other.
 */
function escapeSnippetText(text: string): string {
  return text.replace(MARKDOWN_PUNCTUATION, (char) => {
    if (char === "&") return "&amp;";
    if (char === "<") return "&lt;";
    if (char === ">") return "&gt;";
    return `\\${char}`;
  });
}

/** Defuse a list marker that would otherwise open a block at index 0. */
const escapeLeadingBlock = (text: string): string =>
  text.replace(LEADING_BLOCK, (_, digits = "", delimiter) => `${digits}\\${delimiter}`);

const MARKED_TERM = /<b>(.*?)<\/b>/gs;

/**
 * Translate ts_headline's <b> marks into the <mark> fumadocs renders, as one
 * line of context.
 *
 * Collapsing the whitespace is not cosmetic. ts_headline returns up to two
 * fragments of the raw body, and measured against the real docs those run to
 * 400 characters over eleven lines carrying their own `##` headings and code
 * fences. Rendered as Markdown that puts an <h2> inside a search result row.
 * On one line a `#` is just a `#`, and a fence cannot open.
 */
export function markSnippet(snippet: string): string {
  const oneLine = snippet.replace(/\s+/g, " ").trim();
  let out = "";
  let index = 0;

  for (const match of oneLine.matchAll(MARKED_TERM)) {
    out += escapeSnippetText(oneLine.slice(index, match.index));
    out += `<mark>${escapeSnippetText(match[1])}</mark>`;
    index = match.index + match[0].length;
  }

  return escapeLeadingBlock(`${out}${escapeSnippetText(oneLine.slice(index))}`);
}

/** The minimum locator length. Shorter runs match in too many places to trust. */
const MIN_LOCATOR = 8;

/** A body flattened for searching, plus the way back to its real offsets. */
interface CollapsedBody {
  /** Lowercased, single-spaced. */
  text: string;
  /** offsets[i] is the index in the original body of text[i]. */
  offsets: number[];
}

/**
 * Collapse whitespace while keeping a way back to the original offsets, so a
 * position found in the collapsed text can name a real index in the body.
 */
function collapseWithOffsets(body: string): CollapsedBody {
  let text = "";
  const offsets: number[] = [];
  let inSpace = false;

  for (let index = 0; index < body.length; index++) {
    const char = body[index];
    if (/\s/.test(char)) {
      if (!inSpace && text !== "") {
        text += " ";
        offsets.push(index);
        inSpace = true;
      }
      continue;
    }
    text += char.toLowerCase();
    offsets.push(index);
    inSpace = false;
  }

  return { text, offsets };
}

/**
 * What to look for in the body, best first. The unmarked runs between marks
 * are the discriminating part: the marked terms are by definition the words
 * that appear all over the document, so locating by those finds the first
 * mention rather than the one ts_headline actually quoted.
 */
function locators(snippet: string): string[] {
  const marked: string[] = [];
  const plain: string[] = [];
  let index = 0;

  for (const match of snippet.matchAll(MARKED_TERM)) {
    plain.push(snippet.slice(index, match.index));
    marked.push(match[1]);
    index = match.index + match[0].length;
  }
  plain.push(snippet.slice(index));

  const clean = (run: string): string[] =>
    run
      // ts_headline joins its two fragments with an ellipsis; the text either
      // side of one is contiguous in the body, the whole string is not.
      .split("...")
      .map((part) => part.replace(/\s+/g, " ").trim().toLowerCase())
      .filter((part) => part.length >= MIN_LOCATOR);

  return [
    ...plain.flatMap(clean).sort((a, b) => b.length - a.length),
    ...marked
      .map((term) => term.toLowerCase())
      .filter((term) => term !== "")
      .sort((a, b) => b.length - a.length),
  ];
}

/**
 * The heading the snippet was quoted from, or undefined when it sits above the
 * first heading or cannot be located. Anchoring to the wrong section is worse
 * than not anchoring, so this only answers when it found the text in the body.
 */
export function headingForSnippet(
  body: string,
  headings: readonly DocHeading[],
  snippet: string,
): DocHeading | undefined {
  if (headings.length === 0) return undefined;

  const haystack = collapseWithOffsets(body);
  let at = -1;
  for (const locator of locators(snippet)) {
    const found = haystack.text.indexOf(locator);
    if (found !== -1) {
      at = haystack.offsets[found];
      break;
    }
  }
  if (at === -1) return undefined;

  let found: DocHeading | undefined;
  for (const heading of headings) {
    if (heading.offset > at) break;
    found = heading;
  }
  return found;
}

const docUrl = (slug: string, anchor?: string): string =>
  anchor === undefined ? `/docs/${slug}` : `/docs/${slug}#${anchor}`;

/**
 * A page result, a result per heading that matches the query, and the
 * highlighted snippet anchored to its own section.
 */
export function toSearchResults(hits: readonly SearchSourceHit[], query: string): SortedResult[] {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 1);

  return hits.flatMap((hit) => {
    const headings = extractHeadings(hit.body);
    const results: SortedResult[] = [
      { id: hit.slug, url: docUrl(hit.slug), type: "page", content: hit.title },
    ];

    for (const heading of headings) {
      const text = heading.text.toLowerCase();
      if (!terms.some((term) => text.includes(term))) continue;
      results.push({
        id: `${hit.slug}-${heading.id}`,
        url: docUrl(hit.slug, heading.id),
        type: "heading",
        content: heading.text,
      });
    }

    const snippet = hit.snippet.trim();
    if (snippet !== "") {
      results.push({
        id: `${hit.slug}-snippet`,
        url: docUrl(hit.slug, headingForSnippet(hit.body, headings, hit.snippet)?.id),
        type: "text",
        content: markSnippet(snippet),
      });
    }

    return results;
  });
}
