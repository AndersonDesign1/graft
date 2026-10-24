/**
 * The commands that run the project's MCP tools: content, schema, drafts,
 * functions, and any tool by name. Each one calls the same tool an agent
 * calls, so `--json` prints exactly what the agent receives, and the text
 * output is that answer formatted for a person.
 */
import { readFileSync } from "node:fs";
import { GraftError } from "@usegraft/contracts";
import type { ToolClient, ToolObject, ToolValue } from "@usegraft/mcp";
import { readFrontmatter, writeFrontmatter } from "@usegraft/mdx-safety/frontmatter";
import { UsageError } from "../args";

/* ---- reading arguments --------------------------------------------------- */

export type DocumentId = {
  collection: string;
  slug: string;
};

/** `posts/launch` → { collection: "posts", slug: "launch" }. */
export function parseDocumentId(id: string, command: string): DocumentId {
  const at = id.indexOf("/");
  const collection = id.slice(0, at);
  const slug = id.slice(at + 1).replace(/\.mdx$/, "");
  if (at <= 0 || !slug || slug.includes("/")) {
    throw new UsageError(
      `"${id}" is not a document id.`,
      `Name it as <collection>/<slug>, like posts/launch. Run \`graft ${command} --help\`.`,
      { command, argument: id },
    );
  }
  return { collection, slug };
}

/** A flag's text, or stdin when the value is `-`. */
export function readText(value: string): string {
  return value === "-" ? readFileSync(0, "utf8") : readFileSync(value, "utf8");
}

/** A JSON object from a flag: inline JSON, or `-` for stdin. */
export function parseJsonObject(
  value: string,
  flag: string,
  command: string,
): Record<string, unknown> {
  const text = value === "-" ? readFileSync(0, "utf8") : value;
  let parsed: ToolValue;
  try {
    // SAFETY: JSON.parse only ever produces JSON values.
    parsed = JSON.parse(text) as ToolValue;
  } catch (error) {
    throw new UsageError(
      `${flag} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      `Pass a JSON object, like ${flag} '{"title":"Hello"}', or ${flag} - to read it from stdin. Run \`graft ${command} --help\`.`,
      { command, flag },
    );
  }
  if (!isObject(parsed)) {
    throw new UsageError(
      `${flag} must be a JSON object.`,
      `Pass an object, like ${flag} '{"title":"Hello"}'.`,
      {
        command,
        flag,
      },
    );
  }
  return parsed;
}

/** A JSON value from a flag; anything that is not JSON is taken as a string. */
export function parseJsonValue(value: string): ToolValue {
  try {
    // SAFETY: JSON.parse only ever produces JSON values.
    return JSON.parse(value) as ToolValue;
  } catch {
    return value;
  }
}

const isObject = (value: ToolValue | undefined): value is ToolObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The tool's answer as the object `--json` prints. Every tool used here answers with one. */
export function asObject(value: ToolValue, tool: string): ToolObject {
  if (isObject(value)) return value;
  throw new Error(`${tool} answered with ${JSON.stringify(value)}, not an object.`);
}

const text = (value: ToolValue | undefined): string | undefined =>
  typeof value === "string" ? value : undefined;

const list = (value: ToolValue | undefined): ToolValue[] => (Array.isArray(value) ? value : []);

const objects = (value: ToolValue | undefined): ToolObject[] => list(value).filter(isObject);

/** A document's title for a listing: its title or name field, when there is one. */
function titleOf(data: ToolValue | undefined): string | undefined {
  if (!isObject(data)) return undefined;
  return text(data.title) ?? text(data.name);
}

/**
 * Rethrow a tool's failure. An approval refusal says how to retry over MCP or
 * HTTP; from the CLI the retry is the same command with --approval, so its
 * fix says that instead.
 */
export function rethrowWithRetry(error: unknown, retry: string): never {
  if (!(error instanceof GraftError) || error.code !== "DESTRUCTIVE_OP_REQUIRES_APPROVAL") {
    throw error;
  }
  const id = error.details?.approvalId;
  if (typeof id !== "string") throw error;
  const options: ConstructorParameters<typeof GraftError>[0] = {
    code: error.code,
    message: error.message,
    fix: `Ask a person to run \`graft approve ${id}\`, then run \`${retry} --approval ${id}\`. The approval works once, for this exact call.`,
  };
  if (error.details) options.details = error.details;
  throw new GraftError(options);
}

/** A word as a shell reads it back: bare when that is safe, else in single quotes. */
export function shellQuote(word: string): string {
  return /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;
}

/**
 * The command to repeat once a person approves: the same words on the same
 * branch, since an approval is for the call and not for where it runs.
 */
export function retryCommand(words: readonly string[], branchId: string | undefined): string {
  const all = branchId === undefined ? words : [...words, "--branch", branchId];
  return ["graft", ...all].map(shellQuote).join(" ");
}

/* ---- content ------------------------------------------------------------- */

export interface ContentListing {
  branch: string | null;
  collections: { collection: string; documents: ToolObject[] }[];
}

/** Every document in one collection, or in every file-authored collection. */
export async function listContent(
  tools: ToolClient,
  collection: string | undefined,
): Promise<ContentListing> {
  if (collection !== undefined) {
    const answer = asObject(await tools.call("list_content", { collection }), "list_content");
    return { branch: null, collections: [{ collection, documents: objects(answer.documents) }] };
  }
  const listed = asObject(await tools.call("list_collections"), "list_collections");
  const result: ContentListing = { branch: text(listed.branch) ?? null, collections: [] };
  for (const entry of objects(listed.collections)) {
    const name = text(entry.name);
    // Records in a db-authoritative collection are operational data, read
    // through its functions, not documents.
    if (!name || entry.authority === "db-authoritative") continue;
    const answer = asObject(await tools.call("list_content", { collection: name }), "list_content");
    result.collections.push({ collection: name, documents: objects(answer.documents) });
  }
  return result;
}

export function formatContentListing(listing: ContentListing): string[] {
  const lines: string[] = [];
  for (const { collection, documents } of listing.collections) {
    for (const doc of documents) {
      const title = titleOf(doc.data);
      const label = title ? `${String(doc.slug)}  (${title})` : String(doc.slug);
      lines.push(`${collection}/${label}  ${String(doc.sourcePath)}`);
    }
  }
  const count = lines.length;
  if (count === 0) return ["No documents."];
  return [`${count} document(s):`, "", ...lines];
}

/** A document as the file it is: frontmatter, then the body. */
export function formatDocument(doc: ToolObject): string {
  const data = isObject(doc.data) ? doc.data : {};
  // A blank line after the frontmatter, as authored files have it; reading
  // the file back drops it again.
  return writeFrontmatter(`\n${text(doc.body) ?? ""}`, data).trimEnd();
}

export function formatSearch(answer: ToolObject): string[] {
  const hits = objects(answer.hits);
  if (hits.length === 0) return [`Nothing matches "${String(answer.query)}".`];
  const lines = [`${hits.length} match(es) for "${String(answer.query)}":`, ""];
  for (const hit of hits) {
    const title = titleOf(hit.data);
    lines.push(
      `${String(hit.collection)}/${String(hit.slug)}${title ? `  ${title}` : ""}  (${String(hit.sourcePath)})`,
    );
    // The index marks matched words with <b>; a terminal shows the words alone.
    const snippet = text(hit.snippet)
      ?.replace(/<\/?b>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (snippet) lines.push(`    ${snippet}`);
  }
  return lines;
}

export interface WriteInput {
  data: Record<string, unknown>;
  body?: string;
}

export interface WriteSource {
  file: string | undefined;
  data: string | undefined;
  bodyFile: string | undefined;
}

/** What `content write` sends: from an MDX file, or from --data and --body-file. */
export function writeInput(options: WriteSource, command: string): WriteInput {
  if (options.file !== undefined) {
    if (options.data !== undefined || options.bodyFile !== undefined) {
      throw new UsageError(
        "--file cannot be combined with --data or --body-file.",
        "Use --file for a whole MDX file, or --data with an optional --body-file.",
        { command },
      );
    }
    const { data, content } = readFrontmatter(readText(options.file), options.file);
    // The blank line after the frontmatter is the file's separator, not the
    // body's: the write keeps the existing file's own, so sending it too would
    // add a line on every get and write.
    return { data, body: content.replace(/^\r?\n/, "") };
  }
  if (options.data === undefined) {
    throw new UsageError(
      `graft ${command} needs --file or --data.`,
      "Pass --file <doc.mdx> (or --file - for stdin), or --data '<json>' with an optional --body-file.",
      { command },
    );
  }
  const input: WriteInput = { data: parseJsonObject(options.data, "--data", command) };
  if (options.bodyFile !== undefined) input.body = readText(options.bodyFile);
  return input;
}

export function formatWrite(answer: ToolObject): string[] {
  const changes = isObject(answer.changes) ? answer.changes : {};
  const count = (key: string): number => list(changes[key]).length;
  const draft =
    answer.gitSha === null && count("added") + count("changed") + count("removed") === 0;
  return [
    `Wrote ${String(answer.written)} on branch "${String(answer.branch)}"` +
      (draft
        ? "."
        : `: +${count("added")} added, ~${count("changed")} changed, -${count("removed")} removed.`),
    ...formatRefresh(answer.refresh),
  ];
}

/** The write landed, but the app was not told: say so, and that a retry is wrong. */
function formatRefresh(refresh: ToolValue | undefined): string[] {
  if (!isObject(refresh) || refresh.ok !== false) return [];
  const lines = [
    `The app was not told to refresh, so it may show the old copy: ${String(refresh.error)}: ${String(refresh.message)}`,
    "  Do not write again: the write succeeded.",
  ];
  if (text(refresh.fix)) lines.push(`  fix: ${String(refresh.fix)}`);
  return lines;
}

export interface SetResult {
  collection: string;
  field: string;
  saved: { slug: string; written: ToolValue; refresh?: ToolValue }[];
  failed: { slug: string; error: string; message: string; fix?: string }[];
}

/**
 * Set one field on many documents, each written as `content write` would. A
 * document that fails does not stop the others. `null` removes the field.
 */
export async function setField(
  tools: ToolClient,
  collection: string,
  slugs: readonly string[],
  field: string,
  value: ToolValue,
): Promise<SetResult> {
  const result: SetResult = { collection, field, saved: [], failed: [] };
  for (const slug of slugs) {
    try {
      const doc = asObject(await tools.call("get_content", { collection, slug }), "get_content");
      const data: ToolObject = isObject(doc.data) ? { ...doc.data } : {};
      if (value === null) delete data[field];
      else data[field] = value;
      const answer = asObject(
        await tools.call("write_content", { collection, slug, data, body: text(doc.body) ?? "" }),
        "write_content",
      );
      const saved: SetResult["saved"][number] = { slug, written: answer.written ?? null };
      if (answer.refresh !== undefined) saved.refresh = answer.refresh;
      result.saved.push(saved);
    } catch (error) {
      if (!(error instanceof GraftError)) throw error;
      const failure: SetResult["failed"][number] = {
        slug,
        error: error.code,
        message: error.message,
      };
      if (error.fix) failure.fix = error.fix;
      result.failed.push(failure);
    }
  }
  return result;
}

export function formatSet(result: SetResult): string[] {
  const lines = [
    `Set ${result.field} on ${result.saved.length} of ${result.saved.length + result.failed.length} document(s) in ${result.collection}.`,
  ];
  for (const saved of result.saved) {
    const refresh = formatRefresh(saved.refresh);
    if (refresh.length > 0)
      lines.push(`  ${result.collection}/${saved.slug}: ${refresh.join("\n  ")}`);
  }
  for (const failure of result.failed) {
    lines.push(`  ${result.collection}/${failure.slug}: ${failure.error}: ${failure.message}`);
    if (failure.fix) lines.push(`    fix: ${failure.fix}`);
  }
  return lines;
}

/* ---- schema, drafts, functions, tools ----------------------------------- */

export function formatSchema(answer: ToolObject, only: string | undefined): string[] {
  const lines: string[] = [];
  for (const collection of objects(answer.collections)) {
    if (only !== undefined && collection.name !== only) continue;
    if (lines.length > 0) lines.push("");
    const authority = text(collection.authority);
    lines.push(`${String(collection.name)}${authority ? `  (${authority})` : ""}`);
    if (text(collection.description)) lines.push(`  ${String(collection.description)}`);
    for (const field of objects(collection.fields)) {
      const name = `${String(field.name)}${field.optional === true ? "?" : ""}`;
      const about = text(field.description);
      lines.push(`  ${name.padEnd(20)} ${String(field.type)}${about ? `  ${about}` : ""}`);
    }
  }
  if (only !== undefined && lines.length === 0) {
    throw new GraftError({
      code: "COLLECTION_NOT_FOUND",
      message: `There is no collection called "${only}".`,
      fix: "Run `graft schema` to list every collection.",
      details: { collection: only },
    });
  }
  return lines;
}

/** The schema answer narrowed to one collection, for `graft schema <collection> --json`. */
export function schemaFor(answer: ToolObject, only: string | undefined): ToolObject {
  if (only === undefined) return answer;
  formatSchema(answer, only);
  return {
    collections: objects(answer.collections).filter((collection) => collection.name === only),
  };
}

export function formatDrafts(answer: ToolObject): string[] {
  const changes = objects(answer.changes);
  const reviews = objects(answer.reviews);
  const lines: string[] = [];
  if (changes.length === 0) lines.push("No drafts.");
  else lines.push(`${changes.length} draft(s):`);
  for (const change of changes) {
    lines.push(
      `  ${String(change.kind).padEnd(9)} ${String(change.path)}${change.conflict === true ? "  (conflict)" : ""}`,
    );
  }
  if (reviews.length > 0) {
    lines.push("", `${reviews.length} waiting for review:`);
    for (const review of reviews) {
      lines.push(`  ${String(review.title)}${text(review.url) ? `  ${String(review.url)}` : ""}`);
    }
  }
  return lines;
}

export function formatFunctions(answer: ToolObject): string[] {
  const fns = objects(answer.functions);
  if (fns.length === 0) return ["No functions. Export them from graft.config.ts."];
  return fns.map((fn) => {
    const flags = [fn.public === true ? "public" : "", fn.destructive === true ? "destructive" : ""]
      .filter(Boolean)
      .join(", ");
    const about = text(fn.description);
    return `${String(fn.name).padEnd(24)} ${String(fn.kind).padEnd(9)}${flags ? ` [${flags}]` : ""}${about ? `  ${about}` : ""}`;
  });
}

export function formatTools(tools: readonly { name: string; title?: string }[]): string[] {
  return tools.map((tool) => `${tool.name.padEnd(20)} ${tool.title ?? ""}`.trimEnd());
}
