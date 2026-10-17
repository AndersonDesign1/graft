/**
 * Compose a document's file bytes for a write.
 *
 * `matter.stringify` is lossy in ways that are invisible in an editor but land
 * in git: js-yaml re-quotes strings by its own rules (`description: Text.` →
 * `description: "Text."`), the blank line after the closing `---` disappears,
 * and a trailing newline is added or removed. That churn is wrong on its own
 * terms — authored bytes belong to whoever authored them, the same reasoning
 * that keeps oxfmt out of `content/` — and it also lies to the ChangeSet: a
 * body-only edit reports the frontmatter as changed.
 *
 * So a write that does not change the frontmatter data must not touch the
 * frontmatter bytes. Only a real data change earns a re-serialisation, because
 * then the author asked for one.
 */
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { GraftError } from "@usegraft/contracts";
import { resolveContained } from "./paths";
import { readFrontmatter, writeFrontmatter } from "@usegraft/mdx-safety/frontmatter";

/**
 * js-yaml folds a string longer than 80 columns into a `>-` block by default,
 * so the first save that rewrote a one-line description turned it into three
 * lines. -1 turns folding off: a one-line string stays on one line.
 */
function stringify(body: string, data: Record<string, unknown>): string {
  return writeFrontmatter(body, data, { lineWidth: -1 });
}

/** Filesystem refusals that mean "this tree is not writable", not "this write was wrong". */
const READ_ONLY_CODES = new Set(["EROFS", "EACCES", "EPERM"]);

/**
 * Write a document's bytes, translating a read-only filesystem into an error
 * that explains itself. Serverless platforms deploy an immutable filesystem, so
 * a Studio or MCP write served from one fails deep inside fs with an opaque
 * errno; authored content being files is the whole model, so the fix is to run
 * the writing surface where the checkout is writable.
 *
 * Takes a root and a relative path rather than a resolved one, and contains it
 * here, because this sink previously trusted whatever path it was handed and
 * `.greptile/rules.md` told reviewers that every sink in this package did its
 * own containment. Studio resolved carefully; MCP's `write_content` did not,
 * and a slug of `"../../escaped"` wrote outside the content tree — the exact
 * bug the rule claimed was impossible. A guarantee that lives in each caller is
 * one a new caller does not inherit.
 *
 * Returns the resolved path, so a caller that needs it does not re-derive it.
 */
export function writeDocumentFile(root: string, sourcePath: string, raw: string): string {
  const fullPath = resolveContained(root, sourcePath, { label: "document" });
  try {
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, raw);
    return fullPath;
  } catch (error) {
    throw readOnlyError(error, "write", fullPath) ?? error;
  }
}

/**
 * Delete a document's file, with the same containment and the same read-only
 * translation as a write. A delete on a serverless filesystem fails the same
 * way a save does and deserves the same explanation.
 */
export function removeDocumentFile(root: string, sourcePath: string): void {
  const fullPath = resolveContained(root, sourcePath, { label: "document" });
  try {
    unlinkSync(fullPath);
  } catch (error) {
    // Already gone, which is what a delete asks for.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw readOnlyError(error, "delete", fullPath) ?? error;
  }
}

/** The explaining error for a read-only refusal, or undefined for any other failure. */
function readOnlyError(error: unknown, verb: string, fullPath: string): GraftError | undefined {
  const code = (error as NodeJS.ErrnoException).code ?? "";
  if (!READ_ONLY_CODES.has(code)) return undefined;
  return new GraftError({
    code: "CONTENT_TREE_READ_ONLY",
    message: `Cannot ${verb} ${fullPath}: the filesystem refused it (${code}).`,
    fix: "Authored content lives in files, so writing needs a writable checkout. Run this surface locally (`graft studio` / `graft mcp`) or in a container with the project mounted read-write; a serverless deployment's filesystem is read-only and should serve reads only.",
    details: { path: fullPath, errno: code },
  });
}

/**
 * Frontmatter block (delimiters included, trailing newline included) and the
 * remainder. Tolerates a BOM and CRLF, and requires the opening `---` at the
 * very start — the same shape gray-matter recognises.
 */
const FRONTMATTER_BLOCK = /^(﻿?---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n)([\s\S]*)$/;

/** Structural equality over parsed YAML values (plain data: no classes, no cycles). */
function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => sameData(item, b[i]));
  }
  if (typeof a === "object" && typeof b === "object" && a !== null && b !== null) {
    const aKeys = Object.keys(a as Record<string, unknown>);
    const bKeys = Object.keys(b as Record<string, unknown>);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every(
      (key) =>
        Object.hasOwn(b as Record<string, unknown>, key) &&
        sameData((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    );
  }
  return false;
}

/** Opening delimiter, the YAML between, closing delimiter — for a known-good block. */
const BLOCK_PARTS = /^(﻿?---[ \t]*\r?\n)([\s\S]*?)(\r?\n---[ \t]*\r?\n)$/;

/** A top-level `key:` at indent zero. Quoted keys included; nested lines are not. */
const TOP_LEVEL_KEY = /^([A-Za-z0-9_$-]+|"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'):(?:\s|$)/;

function unquoteKey(key: string): string {
  if (key.startsWith('"') && key.endsWith('"')) return JSON.parse(key) as string;
  if (key.startsWith("'") && key.endsWith("'")) return key.slice(1, -1).replace(/''/g, "'");
  return key;
}

interface KeyLines {
  key: string;
  /** Every line this key owns: its own, plus its indented continuations. */
  lines: string[];
}

interface ScannedYaml {
  /** Blank lines and comments before the first key, kept as they are. */
  preamble: string[];
  keys: KeyLines[];
}

/** A comment line at the top level, which ends any value above it. */
const TOP_LEVEL_COMMENT = /^#/;

/**
 * Split frontmatter YAML into per-key line runs, or null if it holds anything
 * this function does not model (a document marker, an unkeyed line). Null
 * means the caller re-serialises everything, which is correct but lossy, so
 * the parser refuses rather than guesses.
 */
function scanKeys(yaml: string): ScannedYaml | null {
  const lines = yaml.split(/\r?\n/);
  const preamble: string[] = [];
  const keys: KeyLines[] = [];
  for (const line of lines) {
    const match = TOP_LEVEL_KEY.exec(line);
    if (match?.[1]) {
      keys.push({ key: unquoteKey(match[1]), lines: [line] });
      continue;
    }
    if (keys.length === 0) {
      // Blank padding and comments before the first key belong to nobody.
      if (line.trim() === "" || TOP_LEVEL_COMMENT.test(line)) {
        preamble.push(line);
        continue;
      }
      return null;
    }
    keys[keys.length - 1]?.lines.push(line);
  }
  return keys.length > 0 ? { preamble, keys } : null;
}

/**
 * How many of a key's last lines are blank or top-level comments: the author's
 * spacing and notes before the next key, not part of this value. A rewrite of
 * the value keeps them. Not for a `|+` or `>+` block, whose trailing blank
 * lines are content.
 */
function trailingNotes(lines: readonly string[]): number {
  if (/[|>][0-9]?\+[0-9]?\s*(#.*)?$/.test(lines[0] ?? "")) return 0;
  let count = 0;
  for (let i = lines.length - 1; i > 0; i--) {
    const line = lines[i] ?? "";
    if (line.trim() !== "" && !TOP_LEVEL_COMMENT.test(line)) break;
    count++;
  }
  return count;
}

/**
 * One key rendered by the same serialiser a full rewrite would use, so a
 * patched line is byte-identical to what a full re-serialisation would have
 * produced for it.
 *
 * Two regexes, not one: `matter.stringify` with an empty body emits a trailing
 * blank line after the closing `---`, so the block has to be isolated before it
 * can be split into its parts.
 */
function renderKey(key: string, value: unknown, previous?: string): string[] | null {
  const line = previous === undefined ? null : readKeyLine(previous);
  const comment = line ? trailingComment(line) : "";
  const kept = line ? inQuotesAsBefore(value, line) : null;
  if (kept) return [kept + comment];
  const dumped = stringify("", { [key]: value });
  const block = FRONTMATTER_BLOCK.exec(dumped)?.[1];
  if (!block) return null;
  const inner = BLOCK_PARTS.exec(block)?.[2];
  if (inner === undefined) return null;
  const lines = inner.split(/\r?\n/);
  // A comment after a one-line value stays after the new one. A value that
  // now spans lines has no single place it belongs, so it is dropped.
  return lines.length === 1 ? [lines[0] + comment] : lines;
}

/** The first line of a key, split into `key:`, the spacing after it, and the rest. */
interface KeyLine {
  key: string;
  gap: string;
  rest: string;
}

function readKeyLine(line: string): KeyLine | null {
  const match = /^((?:[A-Za-z0-9_$-]+|"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'):)([ \t]*)(.*)$/.exec(line);
  if (!match?.[1]) return null;
  return { key: match[1], gap: match[2] ?? "", rest: match[3] ?? "" };
}

/**
 * Where a one-line scalar at the start of `rest` ends, or -1 when it is not one
 * this can read: a flow collection, a block scalar, an anchor, alias or tag.
 * In a plain scalar `#` starts a comment only after a space or tab.
 */
function scalarEnd(rest: string): number {
  const quote = rest[0];
  if (quote === '"' || quote === "'") {
    for (let i = 1; i < rest.length; i++) {
      if (quote === '"' && rest[i] === "\\") {
        i++;
        continue;
      }
      if (rest[i] !== quote) continue;
      if (quote === "'" && rest[i + 1] === "'") {
        i++;
        continue;
      }
      return i + 1;
    }
    return -1;
  }
  if (quote === "#") return 0;
  if (quote !== undefined && "[{|>&*!%@`".includes(quote)) return -1;
  const comment = /[ \t]#/.exec(rest);
  return comment ? comment.index : rest.length;
}

/** The author's ` # note` after a key's one-line value, spacing included, or "". */
function trailingComment(line: KeyLine): string {
  const end = scalarEnd(line.rest);
  if (end < 0) return "";
  // `title: # note` has no value, so the note follows the colon's own spacing.
  if (end === 0) return line.rest.startsWith("#") ? line.gap + line.rest : "";
  const tail = line.rest.slice(end);
  return /^[ \t]+#/.test(tail) ? tail : "";
}

/**
 * A one-line string, written in the quotes its key used before: an edited
 * `description: "…"` stays double-quoted rather than taking whatever style
 * js-yaml picks. A JSON string is a valid YAML double-quoted scalar.
 */
function inQuotesAsBefore(value: unknown, line: KeyLine): string | null {
  if (typeof value !== "string" || /[\r\n]/.test(value) || !line.gap) return null;
  const quote = line.rest[0];
  if (quote !== '"' && quote !== "'") return null;
  const prefix = line.key + line.gap;
  return quote === '"'
    ? `${prefix}${JSON.stringify(value)}`
    : `${prefix}'${value.replace(/'/g, "''")}'`;
}

/**
 * Rewrite only the keys whose values actually changed.
 *
 * The whole-block-or-nothing rule was too coarse. `composeDocument` preserved
 * bytes when the data was *entirely* unchanged, but any edit — one number in
 * one field — fell through to `matter.stringify`, which re-quoted every
 * untouched string and dropped the blank line after the closing `---`. That was
 * tolerable while frontmatter was edited by hand and rarely; it stopped being
 * tolerable when the Studio grew a form that makes editing it the normal thing
 * to do, because then every save churns fields nobody touched.
 *
 * Returns null when the block cannot be patched safely, and the caller falls
 * back to a full re-serialisation.
 */
function patchFrontmatter(
  block: string,
  original: Record<string, unknown>,
  data: Record<string, unknown>,
  newline: string,
): string | null {
  const parts = BLOCK_PARTS.exec(block);
  if (!parts) return null;
  const [, open = "", yaml = "", close = ""] = parts;

  const scanned = scanKeys(yaml);
  if (!scanned) return null;

  const out: string[] = [...scanned.preamble];
  const kept = new Set<string>();

  for (const entry of scanned.keys) {
    const notes = entry.lines.slice(entry.lines.length - trailingNotes(entry.lines));
    // A key the caller dropped is a deletion: leave it out, but not the
    // comments after it, which may be about the next key.
    if (!Object.hasOwn(data, entry.key)) {
      out.push(...notes);
      continue;
    }
    kept.add(entry.key);

    if (Object.hasOwn(original, entry.key) && sameData(original[entry.key], data[entry.key])) {
      out.push(...entry.lines);
      continue;
    }
    const rendered = renderKey(entry.key, data[entry.key], entry.lines[0]);
    if (!rendered) return null;
    out.push(...rendered, ...notes);
  }

  // Keys the form added land at the end, where a person appending to YAML by
  // hand would put them.
  for (const key of Object.keys(data)) {
    if (kept.has(key)) continue;
    const rendered = renderKey(key, data[key]);
    if (!rendered) return null;
    out.push(...rendered);
  }

  if (out.length === 0) return null;
  return open + out.join(newline) + close;
}

/**
 * The bytes to write for a document.
 *
 * @param existingRaw The file's current contents, or undefined for a new file.
 * @returns the existing frontmatter with only genuinely changed keys rewritten,
 * plus the new body. Falls back to a full `matter.stringify` when the block
 * cannot be patched safely.
 */
export function composeDocument(
  existingRaw: string | undefined,
  data: Record<string, unknown>,
  body: string,
): string {
  if (existingRaw === undefined) return stringify(body, data);

  const match = FRONTMATTER_BLOCK.exec(existingRaw);
  // No parseable frontmatter block (a new-style file, or one gray-matter would
  // read differently than this regex): fall back rather than guess.
  if (!match) return stringify(body, data);

  const [, block = "", rest = ""] = match;
  const newline = /\r\n/.test(block) ? "\r\n" : "\n";
  const original = readFrontmatter(existingRaw).data;

  const frontmatter = sameData(original, data)
    ? block
    : patchFrontmatter(block, original, data, newline);
  if (frontmatter === null) return stringify(body, data);

  // Preserve the author's separator between frontmatter and body. The body is
  // used exactly as given — trimming its trailing newlines and re-adding one
  // would be the same class of churn this function exists to stop (a file
  // ending in a blank line would silently lose it on every save). The only
  // addition is a final newline when the body lacks one and the file had one.
  // An empty body adds nothing: the separator is already the file's last
  // newline, so adding one made every save of a body-less document a change.
  const separator = /^\r?\n/.exec(rest)?.[0] ?? "";
  const needsNewline = body !== "" && !body.endsWith("\n") && existingRaw.endsWith("\n");
  return frontmatter + separator + body + (needsNewline ? newline : "");
}
