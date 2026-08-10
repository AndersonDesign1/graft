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
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { GraftError } from "@usegraft/contracts";
import matter from "gray-matter";

/** Filesystem refusals that mean "this tree is not writable", not "this write was wrong". */
const READ_ONLY_CODES = new Set(["EROFS", "EACCES", "EPERM"]);

/**
 * Write a document's bytes, translating a read-only filesystem into an error
 * that explains itself. Serverless platforms deploy an immutable filesystem, so
 * a Studio or MCP write served from one fails deep inside fs with an opaque
 * errno; authored content being files is the whole model, so the fix is to run
 * the writing surface where the checkout is writable.
 */
export function writeDocumentFile(fullPath: string, raw: string): void {
  try {
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, raw);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "";
    if (!READ_ONLY_CODES.has(code)) throw error;
    throw new GraftError({
      code: "CONTENT_TREE_READ_ONLY",
      message: `Cannot write ${fullPath}: the filesystem refused it (${code}).`,
      fix: "Authored content lives in files, so writing needs a writable checkout. Run this surface locally (`graft studio` / `graft mcp`) or in a container with the project mounted read-write; a serverless deployment's filesystem is read-only and should serve reads only.",
      details: { path: fullPath, errno: code },
    });
  }
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

/**
 * Split frontmatter YAML into per-key line runs, or null if it holds anything
 * this function does not model (a leading comment, a document marker, an
 * unkeyed line). Null means the caller re-serialises everything, which is
 * correct but lossy — so the parser refuses rather than guesses.
 */
function scanKeys(yaml: string): KeyLines[] | null {
  const lines = yaml.split(/\r?\n/);
  const out: KeyLines[] = [];
  for (const line of lines) {
    const match = TOP_LEVEL_KEY.exec(line);
    if (match?.[1]) {
      out.push({ key: unquoteKey(match[1]), lines: [line] });
      continue;
    }
    if (out.length === 0) {
      // Blank padding before the first key is harmless; anything else is a
      // construct we would drop on the floor.
      if (line.trim() === "") continue;
      return null;
    }
    out[out.length - 1]?.lines.push(line);
  }
  return out.length > 0 ? out : null;
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
function renderKey(key: string, value: unknown): string[] | null {
  const dumped = matter.stringify("", { [key]: value });
  const block = FRONTMATTER_BLOCK.exec(dumped)?.[1];
  if (!block) return null;
  const inner = BLOCK_PARTS.exec(block)?.[2];
  if (inner === undefined) return null;
  return inner.split(/\r?\n/);
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

  const out: string[] = [];
  const kept = new Set<string>();

  for (const entry of scanned) {
    // A key the caller dropped is a deletion: leave it out.
    if (!Object.hasOwn(data, entry.key)) continue;
    kept.add(entry.key);

    if (Object.hasOwn(original, entry.key) && sameData(original[entry.key], data[entry.key])) {
      out.push(...entry.lines);
      continue;
    }
    const rendered = renderKey(entry.key, data[entry.key]);
    if (!rendered) return null;
    out.push(...rendered);
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
  if (existingRaw === undefined) return matter.stringify(body, data);

  const match = FRONTMATTER_BLOCK.exec(existingRaw);
  // No parseable frontmatter block (a new-style file, or one gray-matter would
  // read differently than this regex): fall back rather than guess.
  if (!match) return matter.stringify(body, data);

  const [, block = "", rest = ""] = match;
  const newline = /\r\n/.test(block) ? "\r\n" : "\n";
  const original = matter(existingRaw).data as Record<string, unknown>;

  const frontmatter = sameData(original, data)
    ? block
    : patchFrontmatter(block, original, data, newline);
  if (frontmatter === null) return matter.stringify(body, data);

  // Preserve the author's separator between frontmatter and body. The body is
  // used exactly as given — trimming its trailing newlines and re-adding one
  // would be the same class of churn this function exists to stop (a file
  // ending in a blank line would silently lose it on every save). The only
  // addition is a final newline when the body lacks one and the file had one.
  const separator = /^\r?\n/.exec(rest)?.[0] ?? "";
  const needsNewline = !body.endsWith("\n") && existingRaw.endsWith("\n");
  return frontmatter + separator + body + (needsNewline ? newline : "");
}
