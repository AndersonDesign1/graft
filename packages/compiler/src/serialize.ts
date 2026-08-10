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

/**
 * The bytes to write for a document.
 *
 * @param existingRaw The file's current contents, or undefined for a new file.
 * @returns `existingRaw`'s frontmatter block verbatim plus the new body when the
 * data is unchanged; a full `matter.stringify` otherwise.
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
  if (!sameData(matter(existingRaw).data, data)) return matter.stringify(body, data);

  // Preserve the author's separator between frontmatter and body. The body is
  // used exactly as given — trimming its trailing newlines and re-adding one
  // would be the same class of churn this function exists to stop (a file
  // ending in a blank line would silently lose it on every save). The only
  // addition is a final newline when the body lacks one and the file had one.
  const separator = /^\r?\n/.exec(rest)?.[0] ?? "";
  const newline = /\r\n/.test(block) ? "\r\n" : "\n";
  const needsNewline = !body.endsWith("\n") && existingRaw.endsWith("\n");
  return block + separator + body + (needsNewline ? newline : "");
}
