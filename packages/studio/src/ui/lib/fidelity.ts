/**
 * Can this document survive the rich editor?
 *
 * The first pass answered that with a regex: if the body contained JSX, ESM
 * or a `{expression}`, the rich editor was refused. That was a guess, and it
 * guessed wrong in the expensive direction — measured against the real
 * docs-site tree, every `<Callout>` and `<DocCards>` block round-trips
 * **verbatim**, because commonmark parses an unbroken JSX block as an HTML
 * block and the serialiser writes HTML nodes back untouched. Three of twenty
 * documents were locked out of an editor they were safe in, and those three
 * are the ones a non-technical editor most wants to reach.
 *
 * So stop guessing and measure. The editor re-serialises the document the
 * moment it mounts; comparing that against the bytes we loaded is a *proof*
 * of what saving would do, for this document, in this editor version.
 *
 * ## What counts as damage
 *
 * Measuring raw bytes flags far too much: remark pads table cells and settles
 * on one bullet marker, so twelve of twenty documents "fail" over punctuation
 * that means nothing. The line worth holding is not "identical bytes", it is:
 *
 *   the editor may normalise markdown **style**; it may never change your
 *   **content**.
 *
 * So style-only constructs — trailing space, table delimiter width, cell
 * padding, which bullet character starts a list — are canonicalised on both
 * sides before comparing. Everything else is compared byte for byte.
 *
 * Byte-exact for the rest, rather than comparing syntax trees, because MDX
 * cares about characters markdown does not: a serialiser that escapes `{` to
 * `\{` produces an identical markdown AST and a broken MDX document, so tree
 * equality would wave through the one class of damage that matters most.
 *
 * Fenced code is never normalised. A shell snippet containing `* item` or a
 * markdown example containing `| --- |` is content, not style.
 */

export interface FidelityResult {
  /** Equivalent after a parse -> serialise cycle, ignoring markdown style. */
  lossless: boolean;
  /** 1-based line of the first difference, when there is one. */
  line?: number;
  /** The authored line, and what the editor would write in its place. */
  was?: string;
  now?: string;
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

/**
 * A table delimiter row: `| --- | :-- |`. Alignment colons are meaning and
 * survive; the number of dashes is not.
 */
const DELIMITER_ROW = /^\s*\|?(\s*:?-{1,}:?\s*\|)+\s*:?-{0,}:?\s*\|?\s*$/;

/** `- item`, `* item`, `+ item` — the marker is style, the text is content. */
const BULLET = /^(\s*)[*+-](\s+)/;

function canonicalizeLine(line: string): string {
  if (DELIMITER_ROW.test(line) && line.includes("-")) {
    // Collapse dash runs and cell padding, keep the colons.
    return line
      .replace(/-{2,}/g, "-")
      .replace(/\s*\|\s*/g, "|")
      .trim();
  }
  let out = line.replace(BULLET, "$1-$2");
  // Table body/head rows: one space of padding either side of each pipe.
  if (/^\s*\|.*\|\s*$/.test(out)) out = out.replace(/\s*\|\s*/g, " | ").trim();
  return out;
}

/**
 * Style-insensitive form. Fenced regions pass through untouched, so a code
 * sample that happens to look like a table is compared exactly.
 */
function normalize(body: string): string {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  let fence: string | null = null;
  const out: string[] = [];

  for (const raw of lines) {
    const line = raw.replace(/[ \t]+$/, "");
    const opener = FENCE.exec(line);
    if (fence) {
      out.push(line);
      if (opener && line.trim().startsWith(fence)) fence = null;
      continue;
    }
    if (opener?.[1]) {
      fence = opener[1][0]!.repeat(3);
      out.push(line);
      continue;
    }
    out.push(canonicalizeLine(line));
  }

  return out.join("\n").trim();
}

export function compareRoundTrip(original: string, roundTripped: string): FidelityResult {
  const a = normalize(original);
  const b = normalize(roundTripped);
  if (a === b) return { lossless: true };

  // Report the difference in the operator's own text, not the canonical form —
  // a notice quoting a line they cannot find in their file is useless.
  const originalLines = original.replace(/\r\n/g, "\n").split("\n");
  const al = a.split("\n");
  const bl = b.split("\n");
  let i = 0;
  while (i < Math.max(al.length, bl.length) && al[i] === bl[i]) i++;

  return {
    lossless: false,
    line: i + 1,
    was: originalLines[i] ?? al[i] ?? "",
    now: bl[i] ?? "",
  };
}

/** One sentence an operator can act on, naming the line that would change. */
export function describeFidelity(result: FidelityResult): string {
  if (result.lossless) return "";
  const was = (result.was ?? "").trim();
  const now = (result.now ?? "").trim();
  if (!was) {
    return `The rich editor would add a line at line ${result.line}. Editing the source keeps this document exactly as written.`;
  }
  if (!now) {
    return `The rich editor would drop line ${result.line} (${quote(was)}). Editing the source keeps this document exactly as written.`;
  }
  return `The rich editor would rewrite line ${result.line} — ${quote(was)} becomes ${quote(now)}. Editing the source keeps this document exactly as written.`;
}

function quote(line: string, max = 42): string {
  const clipped = line.length > max ? `${line.slice(0, max - 1)}…` : line;
  return `“${clipped}”`;
}
