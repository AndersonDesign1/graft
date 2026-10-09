/**
 * The list of entries in a collection, fast enough for a catalog of
 * thousands.
 *
 * The content tree used to read and parse every file on every request, and
 * the UI asked for it after every save. Here the checkout is listed with one
 * `stat` per file and only files whose size or mtime changed are parsed
 * again. A remote store's overlay (the editor's draft, and anything published
 * since this deployment was built) is applied on top, so the list is current
 * without one network request per document.
 *
 * Search, filters, sort and paging run on the server over that list, so the
 * browser receives a page, not the catalog.
 */
import { existsSync, statSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { walkContentFiles, type DraftChange, type StoredFile } from "@usegraft/compiler";
import matter from "gray-matter";
import type { CellValue, EntryList, EntryStatus, EntrySummary, Facet } from "../editor-types";
import type { SchemaFieldDto } from "../types";

export interface CatalogEntry {
  path: string;
  slug: string;
  data: Record<string, unknown>;
  body: string;
  problem?: string;
  mtimeMs?: number;
}

/** Frontmatter and body from raw bytes. Never throws: a broken file is listed with its problem. */
export function parseEntry(path: string, raw: string, mtimeMs?: number): CatalogEntry {
  const base =
    path
      .split("/")
      .pop()
      ?.replace(/\.mdx?$/, "") ?? path;
  try {
    // An options object disables gray-matter's process-wide cache, which is
    // keyed by the whole file and would otherwise hold every version of every
    // document ever listed.
    const parsed = matter(raw, {});
    const data = (parsed.data ?? {}) as Record<string, unknown>;
    return {
      path,
      slug: typeof data.slug === "string" && data.slug ? data.slug : base,
      data,
      body: parsed.content,
      ...(mtimeMs !== undefined ? { mtimeMs } : {}),
    };
  } catch (error) {
    return {
      path,
      slug: base,
      data: {},
      body: "",
      problem: error instanceof Error ? error.message.split("\n")[0] : String(error),
      ...(mtimeMs !== undefined ? { mtimeMs } : {}),
    };
  }
}

/** Parsed entries per file, reused while the file's size and mtime hold. */
export class DiskCatalog {
  private readonly cache = new Map<
    string,
    { mtimeMs: number; size: number; entry: CatalogEntry }
  >();

  constructor(private readonly contentDir: string) {}

  list(collection: string): CatalogEntry[] {
    const dir = join(this.contentDir, collection);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
    const out: CatalogEntry[] = [];
    const seen = new Set<string>();
    for (const file of walkContentFiles(dir)) {
      const stat = statSync(file);
      seen.add(file);
      const known = this.cache.get(file);
      if (known && known.mtimeMs === stat.mtimeMs && known.size === stat.size) {
        out.push(known.entry);
        continue;
      }
      const path = relative(this.contentDir, file).split(sep).join("/");
      const entry = parseEntry(path, readFileSync(file, "utf8"), stat.mtimeMs);
      this.cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, entry });
      out.push(entry);
    }
    // Forget deleted files so the cache tracks the tree, not its history.
    for (const key of this.cache.keys()) {
      if (key.startsWith(dir + sep) && !seen.has(key)) this.cache.delete(key);
    }
    return out;
  }
}

/** The checkout's entries with a remote store's newer bytes applied. */
export function applyOverlay(
  entries: CatalogEntry[],
  overlay: ReadonlyMap<string, StoredFile | null>,
  collection: string,
): CatalogEntry[] {
  if (overlay.size === 0) return entries;
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  for (const [path, file] of overlay) {
    if (!path.startsWith(`${collection}/`) || !/\.mdx?$/.test(path)) continue;
    if (file === null) byPath.delete(path);
    else byPath.set(path, parseEntry(path, file.raw));
  }
  return [...byPath.values()];
}

export function statusOf(change: DraftChange | undefined): EntryStatus {
  if (!change) return "published";
  if (change.kind === "added") return "new";
  if (change.kind === "deleted") return "deleted";
  return "changed";
}

const CELL_TYPES = new Set([
  "string",
  "text",
  "number",
  "boolean",
  "datetime",
  "select",
  "reference",
]);
const FACET_TYPES = new Set(["select", "boolean", "reference"]);

function cell(value: unknown): CellValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.length > 140 ? `${value.slice(0, 139)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  return null;
}

function imageOf(data: Record<string, unknown>, fields: SchemaFieldDto[]): string | undefined {
  for (const field of fields) {
    const value = data[field.name];
    if (field.type === "asset") {
      const key = (value as { key?: unknown } | undefined)?.key;
      if (typeof key === "string" && key) return key;
    }
    if (field.type === "array" && field.items?.type === "asset" && Array.isArray(value)) {
      const key = (value[0] as { key?: unknown } | undefined)?.key;
      if (typeof key === "string" && key) return key;
    }
  }
  return undefined;
}

export function titleOf(entry: Pick<CatalogEntry, "data" | "slug">): string {
  const { data } = entry;
  for (const key of ["title", "name", "label", "heading"]) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return entry.slug;
}

export function summarise(
  collection: string,
  entries: CatalogEntry[],
  fields: SchemaFieldDto[],
  changes: ReadonlyMap<string, DraftChange>,
): EntrySummary[] {
  const columns = fields.filter((field) => CELL_TYPES.has(field.type));
  return entries.map((entry) => {
    const change = changes.get(entry.path);
    const image = imageOf(entry.data, fields);
    return {
      path: entry.path,
      collection,
      slug: entry.slug,
      title: titleOf(entry),
      status: statusOf(change),
      conflict: change?.conflict ?? false,
      fields: Object.fromEntries(
        columns.map((field) => [field.name, cell(entry.data[field.name])]),
      ),
      ...(image ? { image } : {}),
      ...(entry.mtimeMs !== undefined ? { updatedAt: new Date(entry.mtimeMs).toISOString() } : {}),
      ...(entry.problem ? { problem: entry.problem } : {}),
    };
  });
}

export interface EntryQuery {
  q?: string;
  /** `all` | `unpublished` | an EntryStatus */
  status?: string;
  /** Exact match on a field's value, as a string. */
  where?: Record<string, string>;
  /** `title` | `updated` | `site` | a field key */
  sort?: string;
  dir?: "asc" | "desc";
  cursor?: string;
  limit?: number;
}

const MAX_LIMIT = 500;

/**
 * The order the site shows things in when the collection says what that is
 * (`section`, `order`), so an editor sees the catalog the way a visitor does.
 */
function siteOrder(sections: readonly string[] | undefined) {
  const rank = (section: unknown): number => {
    if (!sections?.length || typeof section !== "string") return 0;
    const i = sections.indexOf(section);
    return i === -1 ? sections.length : i;
  };
  return (a: EntrySummary, b: EntrySummary): number => {
    const bySection = rank(a.fields.section) - rank(b.fields.section);
    if (bySection !== 0) return bySection;
    const ao = typeof a.fields.order === "number" ? a.fields.order : Number.POSITIVE_INFINITY;
    const bo = typeof b.fields.order === "number" ? b.fields.order : Number.POSITIVE_INFINITY;
    if (ao !== bo) return ao - bo;
    return a.title.localeCompare(b.title);
  };
}

function compareCells(a: CellValue, b: CellValue): number {
  if (a === b) return 0;
  // Empty values sort last whichever way the list is ordered.
  if (a === null) return 1;
  if (b === null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

export function queryEntries(
  collection: string,
  all: EntrySummary[],
  fields: SchemaFieldDto[],
  query: EntryQuery,
  sections?: readonly string[],
): EntryList {
  const unpublished = all.filter((entry) => entry.status !== "published").length;
  let items = all;

  const status = query.status ?? "all";
  if (status === "unpublished") items = items.filter((entry) => entry.status !== "published");
  else if (status !== "all") items = items.filter((entry) => entry.status === status);

  const terms = (query.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length > 0) {
    items = items.filter((entry) => {
      const haystack = [
        entry.title,
        entry.slug,
        ...Object.values(entry.fields).filter((value) => typeof value === "string"),
      ]
        .join(" ")
        .toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }

  for (const [field, value] of Object.entries(query.where ?? {})) {
    items = items.filter((entry) => String(entry.fields[field] ?? "") === value);
  }

  const sort = query.sort ?? "site";
  const direction = query.dir === "desc" ? -1 : 1;
  const usesSiteOrder =
    sort === "site" &&
    all.some(
      (entry) => typeof entry.fields.order === "number" || entry.fields.section !== undefined,
    );
  const sorted = [...items].sort((a, b) => {
    if (sort === "updated")
      return direction * compareCells(b.updatedAt ?? null, a.updatedAt ?? null);
    if (sort === "title" || (sort === "site" && !usesSiteOrder)) {
      return direction * a.title.localeCompare(b.title, undefined, { numeric: true });
    }
    if (sort === "site") return direction * siteOrder(sections)(a, b);
    return (
      direction * compareCells(a.fields[sort] ?? null, b.fields[sort] ?? null) ||
      a.title.localeCompare(b.title)
    );
  });

  const limit = Math.min(Math.max(1, query.limit ?? 100), MAX_LIMIT);
  const offset = Math.max(0, Number.parseInt(query.cursor ?? "0", 10) || 0);
  const page = sorted.slice(offset, offset + limit);

  const facets: Facet[] = fields
    .filter((field) => FACET_TYPES.has(field.type))
    .map((field) => {
      const counts = new Map<string, number>();
      for (const entry of all) {
        const value = entry.fields[field.name];
        if (value === null || value === undefined) continue;
        counts.set(String(value), (counts.get(String(value)) ?? 0) + 1);
      }
      return {
        field: field.name,
        values: [...counts]
          .map(([value, count]) => ({ value, count }))
          .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)),
      };
    });

  return {
    collection,
    total: sorted.length,
    items: page,
    nextCursor: offset + limit < sorted.length ? String(offset + limit) : null,
    counts: { all: all.length, unpublished },
    facets,
  };
}
