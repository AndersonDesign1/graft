/**
 * What the editor API does, independent of HTTP.
 *
 * Every write goes through the mounted content store. On the filesystem
 * store the index is recompiled afterwards, exactly as the old save did; on
 * a remote store it is not, because a draft must never reach the live site's
 * index: production recompiles when the host redeploys the published commit.
 */
import {
  FilesystemStore,
  compile,
  composeDocument,
  parseDocument,
  requireCollection,
  SLUG_RE,
  type ContentStore,
  type DraftChange,
  type DraftWorkflow,
  type StoreActor,
} from "@usegraft/compiler";
import { GraftError } from "@usegraft/contracts";
import type { AnyCollection } from "@usegraft/core";
import type { Database } from "@usegraft/db";
import { assertSafeMdx, type MdxTrust } from "@usegraft/mdx-safety";
import matter from "gray-matter";
import type {
  DraftDiffDto,
  DraftChangeDto,
  DraftsDto,
  EntryDto,
  EntryList,
  PublishAction,
  PublishResultDto,
  SaveEntryResult,
} from "../editor-types";
import type { SchemaFieldDto } from "../types";
import { readChanges } from "../git";
import {
  DiskCatalog,
  applyOverlay,
  parseEntry,
  queryEntries,
  statusOf,
  searchText,
  summarise,
  titleOf,
  type CatalogEntry,
  type EntryQuery,
} from "./catalog";
import { slugify as slugText } from "../slug";
import { lineDiff } from "./line-diff";
import { localDrafts } from "./local-drafts";

export interface EditorServiceOptions {
  contentDir: string;
  collections: Record<string, AnyCollection>;
  db: Database;
  branchId: string;
  mdxTrust?: MdxTrust;
  store?: ContentStore;
}

export class EditorService {
  readonly store: ContentStore;
  readonly drafts: DraftWorkflow;
  private readonly catalog: DiskCatalog;

  constructor(private readonly options: EditorServiceOptions) {
    this.store = options.store ?? new FilesystemStore(options.contentDir);
    this.drafts = this.store.drafts ?? localDrafts(options.contentDir);
    this.catalog = new DiskCatalog(options.contentDir);
  }

  get remote(): boolean {
    return this.store.kind !== "filesystem";
  }

  /** What Publish does for a person, given whether they may publish directly. */
  publishAction(canPublishDirectly: boolean): PublishAction {
    if (!this.remote) return "commit";
    const mode = this.store.info().publishMode ?? "direct";
    return mode === "direct" && canPublishDirectly ? "publish" : "review";
  }

  async history(): Promise<{ available: boolean; reason?: string }> {
    if (this.remote) return { available: true };
    const status = await readChanges(this.options.contentDir);
    return status.tracked ? { available: true } : { available: false, reason: status.reason };
  }

  /* ---- reading --------------------------------------------------------- */

  private collection(name: string): AnyCollection {
    return requireCollection(this.options.collections, name);
  }

  private fileCollection(name: string): AnyCollection {
    const collection = this.collection(name);
    if (collection.authority === "db-authoritative") {
      throw new GraftError({
        code: "AUTHORITY_MISMATCH",
        message: `"${name}" holds records in the database, not documents.`,
        fix: "Its records change through the site's functions, not the editor.",
        details: { collection: name },
      });
    }
    return collection;
  }

  private async changeMap(actor: StoreActor): Promise<Map<string, DraftChange>> {
    try {
      const changes = await this.drafts.changes(actor);
      return new Map(changes.map((change) => [change.path, change]));
    } catch {
      // No git, or no repository: everything reads as published, which is
      // what the editor can act on.
      return new Map();
    }
  }

  private async entries(name: string, actor: StoreActor): Promise<CatalogEntry[]> {
    const disk = this.catalog.list(name);
    if (!this.store.overlay) return disk;
    return applyOverlay(disk, await this.store.overlay(actor), name);
  }

  async list(
    name: string,
    fields: SchemaFieldDto[],
    query: EntryQuery,
    actor: StoreActor,
  ): Promise<EntryList> {
    const collection = this.fileCollection(name);
    const [entries, changes] = await Promise.all([
      this.entries(name, actor),
      this.changeMap(actor),
    ]);
    return queryEntries(
      name,
      summarise(name, entries, fields, changes),
      fields,
      query,
      collection.sections,
      query.q
        ? new Map(entries.map((entry) => [entry.path, searchText(entry, fields)]))
        : undefined,
    );
  }

  /** The path for a slug: the file that declares it, or the conventional one. */
  private async pathFor(name: string, slug: string, actor: StoreActor): Promise<string> {
    // A slug names a file: "shirts/blue" would save a nested file listed
    // under a different slug. Every entry's own slug already has this shape.
    if (!SLUG_RE.test(slug)) throw invalidSlug(slug);
    const match = (await this.entries(name, actor)).find((entry) => entry.slug === slug);
    return match?.path ?? `${name}/${slug}.mdx`;
  }

  async read(name: string, slug: string, actor: StoreActor): Promise<EntryDto> {
    this.fileCollection(name);
    const path = await this.pathFor(name, slug, actor);
    const file = await this.store.read(path, actor);
    if (!file) {
      throw new GraftError({
        code: "DOCUMENT_NOT_FOUND",
        message: `There is no "${slug}" in ${name}.`,
        fix: "It may have been deleted or renamed. Go back to the list and open it again.",
        details: { collection: name, slug },
      });
    }
    const parsed = matter(file.raw, {});
    const change = (await this.changeMap(actor)).get(path);
    return {
      collection: name,
      slug,
      path,
      data: parsed.data as Record<string, unknown>,
      body: parsed.content.replace(/^\n/, ""),
      raw: file.raw,
      version: file.version,
      status: statusOf(change),
      conflict: change?.conflict ?? false,
    };
  }

  /* ---- writing --------------------------------------------------------- */

  private async afterWrite(): Promise<void> {
    if (this.remote) return;
    await compile({
      contentDir: this.options.contentDir,
      collections: this.options.collections,
      db: this.options.db,
      mdxTrust: this.options.mdxTrust,
      branchId: this.options.branchId,
    });
  }

  private async result(
    name: string,
    slug: string,
    path: string,
    version: string | null,
    actor: StoreActor,
  ): Promise<SaveEntryResult> {
    const change = (await this.changeMap(actor)).get(path);
    return { collection: name, slug, path, version, status: statusOf(change) };
  }

  /**
   * Validate and write. The same checks MCP's write_content makes: the
   * schema, MDX safety, a slug that names one file. Frontmatter bytes are
   * kept unless the data actually changed.
   */
  async save(
    input: {
      collection: string;
      slug: string;
      data?: Record<string, unknown>;
      body?: string;
      raw?: string;
      baseVersion?: string | null;
    },
    actor: StoreActor,
  ): Promise<SaveEntryResult> {
    const collection = this.fileCollection(input.collection);
    const path = await this.pathFor(input.collection, input.slug, actor);
    const existing = await this.store.read(path, actor);

    let raw: string;
    let body: string;
    if (typeof input.raw === "string") {
      raw = input.raw;
      const parsed = matter(raw, {});
      body = parsed.content;
      assertSlugMatches(parsed.data, input.slug);
    } else {
      if (!input.data) {
        throw new GraftError({
          code: "INPUT_VALIDATION_FAILED",
          message: "A save needs the entry's fields or its full source.",
          fix: 'Send { "data", "body" } or { "raw" }.',
        });
      }
      assertSlugMatches(input.data, input.slug);
      body = input.body ?? "";
      raw = composeDocument(existing?.raw, input.data, body);
    }
    assertSafeMdx(body, { label: `${input.collection}/${input.slug}` });
    parseDocument(raw, collection, path);

    const { version } = await this.store.write(path, raw, {
      actor,
      ...(input.baseVersion !== undefined ? { baseVersion: input.baseVersion } : {}),
    });
    await this.afterWrite();
    return this.result(input.collection, input.slug, path, version, actor);
  }

  async create(
    input: { collection: string; slug?: string; data: Record<string, unknown>; body?: string },
    actor: StoreActor,
  ): Promise<SaveEntryResult> {
    const collection = this.fileCollection(input.collection);
    const taken = new Set((await this.entries(input.collection, actor)).map((entry) => entry.slug));
    let slug = input.slug?.trim();
    if (slug) {
      if (!SLUG_RE.test(slug)) throw invalidSlug(slug);
      if (taken.has(slug)) {
        throw new GraftError({
          code: "SLUG_NOT_UNIQUE",
          message: `"${slug}" is already used in ${input.collection}.`,
          fix: "Choose another URL name.",
          details: { collection: input.collection, slug },
        });
      }
    } else {
      slug = uniqueSlug(slugify(titleOf({ data: input.data, slug: "untitled" })), taken);
    }
    assertSlugMatches(input.data, slug);
    const path = `${input.collection}/${slug}.mdx`;
    const body = input.body ?? "";
    const raw = composeDocument(undefined, input.data, body);
    assertSafeMdx(body, { label: path });
    parseDocument(raw, collection, path);
    const { version } = await this.store.write(path, raw, { actor, baseVersion: null });
    await this.afterWrite();
    return this.result(input.collection, slug, path, version, actor);
  }

  async remove(
    input: { collection: string; slug: string; baseVersion?: string | null },
    actor: StoreActor,
  ): Promise<SaveEntryResult> {
    this.fileCollection(input.collection);
    const path = await this.pathFor(input.collection, input.slug, actor);
    await this.store.write(path, null, {
      actor,
      ...(input.baseVersion !== undefined ? { baseVersion: input.baseVersion } : {}),
    });
    await this.afterWrite();
    return this.result(input.collection, input.slug, path, null, actor);
  }

  async duplicate(
    input: { collection: string; slug: string },
    actor: StoreActor,
  ): Promise<SaveEntryResult> {
    const source = await this.read(input.collection, input.slug, actor);
    const taken = new Set((await this.entries(input.collection, actor)).map((entry) => entry.slug));
    const slug = uniqueSlug(`${input.slug}-copy`, taken);
    const data: Record<string, unknown> = { ...source.data };
    if (typeof data.slug === "string") data.slug = slug;
    for (const key of ["title", "name"]) {
      if (typeof data[key] === "string") {
        data[key] = `${data[key] as string} (copy)`;
        break;
      }
    }
    return this.create({ collection: input.collection, slug, data, body: source.body }, actor);
  }

  /* ---- drafts ---------------------------------------------------------- */

  async draftList(actor: StoreActor, canPublishDirectly: boolean): Promise<DraftsDto> {
    const [changes, reviews] = await Promise.all([
      this.drafts.changes(actor).catch(() => []),
      this.drafts.reviews(actor).catch(() => []),
    ]);
    const described: DraftChangeDto[] = [];
    for (const change of changes) {
      const collection = change.path.split("/")[0] ?? "";
      let entry: CatalogEntry | undefined;
      if (change.kind !== "deleted") {
        const file = await this.store.read(change.path, actor).catch(() => null);
        if (file) entry = parseEntry(change.path, file.raw);
      } else {
        const published = await this.drafts.readPublished(change.path).catch(() => null);
        if (published) entry = parseEntry(change.path, published.raw);
      }
      const slug =
        entry?.slug ??
        change.path
          .split("/")
          .pop()
          ?.replace(/\.mdx?$/, "") ??
        "";
      described.push({
        path: change.path,
        collection,
        slug,
        title: entry ? titleOf(entry) : slug,
        kind: change.kind,
        conflict: change.conflict,
      });
    }
    return { publish: this.publishAction(canPublishDirectly), changes: described, reviews };
  }

  async diff(path: string, actor: StoreActor): Promise<DraftDiffDto> {
    const [before, after] = await Promise.all([
      this.drafts.readPublished(path),
      this.store.read(path, actor),
    ]);
    const old = before ? parseEntry(path, before.raw) : null;
    const next = after ? parseEntry(path, after.raw) : null;
    const keys = new Set([...Object.keys(old?.data ?? {}), ...Object.keys(next?.data ?? {})]);
    const fields = [...keys]
      .filter((key) => !sameValue(old?.data[key], next?.data[key]))
      .map((field) => ({
        field,
        before: old?.data[field] ?? null,
        after: next?.data[field] ?? null,
      }));
    return {
      path,
      fields,
      bodyChanged: (old?.body ?? "").trim() !== (next?.body ?? "").trim(),
      file: lineDiff(path, before?.raw ?? null, after?.raw ?? null),
    };
  }

  async publish(
    input: { paths: string[]; message?: string; resolve?: Record<string, "mine" | "theirs"> },
    actor: StoreActor,
    canPublishDirectly: boolean,
  ): Promise<PublishResultDto> {
    const action = this.publishAction(canPublishDirectly);
    if (this.remote) {
      // A remote draft was never compiled, so it is checked here, before it
      // can reach the branch the site builds from.
      for (const path of input.paths) {
        const file = await this.store.read(path, actor);
        if (!file) continue;
        const name = path.split("/")[0] ?? "";
        const collection = this.options.collections[name];
        if (collection) parseDocument(file.raw, collection, path);
      }
    }
    const result = await this.drafts.publish({
      actor,
      paths: input.paths,
      ...(input.message !== undefined ? { message: input.message } : {}),
      ...(input.resolve ? { resolve: input.resolve } : {}),
      ...(this.remote ? { mode: action === "publish" ? "direct" : "review" } : {}),
    });
    return {
      action,
      published: result.published,
      tookTheirs: result.tookTheirs,
      commit: result.commit
        ? {
            sha: result.commit.sha,
            shortSha: result.commit.sha.slice(0, 7),
            ...(result.commit.url ? { url: result.commit.url } : {}),
          }
        : null,
      ...(result.review ? { review: result.review } : {}),
    };
  }

  async discard(paths: string[], actor: StoreActor): Promise<void> {
    await this.drafts.discard(actor, paths);
    await this.afterWrite();
  }
}

/** Structural equality over parsed YAML values (plain data, Dates by time). */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => sameValue(item, b[i]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ak = Object.keys(a as object);
    const bk = Object.keys(b as object);
    return (
      ak.length === bk.length &&
      ak.every((key) =>
        sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
      )
    );
  }
  return false;
}

/**
 * A `slug` in frontmatter overrides the file name, so one that disagrees with
 * the entry being saved would index the file as a different entry, possibly a
 * duplicate. The same rule `write_content` applies.
 */
function assertSlugMatches(data: Record<string, unknown>, slug: string): void {
  if (data.slug === undefined || data.slug === slug) return;
  throw new GraftError({
    code: "INVALID_SLUG",
    message: `The entry's slug field ("${String(data.slug)}") doesn't match its URL name ("${slug}").`,
    fix: "Remove slug from the fields, or set it to the URL name.",
    details: { slug, frontmatterSlug: data.slug },
  });
}

/** "Blue Linen Shirt!" -> "blue-linen-shirt". */
export function slugify(title: string): string {
  return slugText(title) || "untitled";
}

export function uniqueSlug(wanted: string, taken: ReadonlySet<string>): string {
  if (!taken.has(wanted)) return wanted;
  for (let n = 2; ; n += 1) {
    const candidate = `${wanted}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function invalidSlug(slug: string): GraftError {
  return new GraftError({
    code: "INVALID_SLUG",
    message: `"${slug}" can't be used as a URL name.`,
    fix: 'Use lowercase letters, numbers and single hyphens, like "summer-linen-shirt".',
    details: { slug, pattern: SLUG_RE.source },
  });
}
