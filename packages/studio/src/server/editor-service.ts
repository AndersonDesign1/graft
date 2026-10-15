/**
 * What the editor API does, independent of HTTP.
 *
 * Every write goes through the mounted content store. On the filesystem
 * store the files it wrote are projected into the index afterwards; on a
 * remote store they are not, because a draft must never reach the live site's
 * index: production recompiles when the host redeploys the published commit.
 */
import {
  FilesystemStore,
  checkRemoval,
  notifyContentChange,
  type ContentChangeListener,
  type ContentChangeNotice,
  composeDocument,
  parseDocument,
  SLUG_RE,
  type ContentStore,
  type DraftChange,
  type DraftWorkflow,
  type StoreActor,
} from "@usegraft/compiler";
import { GraftError, type ChangeSet } from "@usegraft/contracts";
import type { AnyCollection } from "@usegraft/core";
import type { Database } from "@usegraft/db";
import { assertSafeMdx, type MdxTrust } from "@usegraft/mdx-safety";
import matter from "gray-matter";
import type {
  ActivityDocumentDto,
  AssetUseDto,
  ActivityDto,
  ActivityEventDto,
  DraftDiffDto,
  DraftChangeDto,
  DraftsDto,
  EntryDto,
  EntryList,
  PublishAction,
  PublishResultDto,
  SaveEntryResult,
  SetFieldResultDto,
  VersionDetailDto,
  VersionListDto,
} from "../editor-types";
import type { SchemaFieldDto } from "../types";
import { requireCollection } from "../content";
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
import { commitMessageFor } from "../commit-message";
import { slugify as slugText } from "../slug";
import { lineDiff } from "./line-diff";
import { compileIndex } from "./compile-index";
import { localDrafts } from "./local-drafts";
import { localHistory, type LocalHistory } from "./local-history";

/** What a save of one entry carries: its fields and body, or its full source. */
interface SaveInput {
  collection: string;
  slug: string;
  data?: Record<string, unknown>;
  body?: string;
  raw?: string;
  baseVersion?: string | null;
}

/** Documents named per activity entry; the rest are counted. */
const ACTIVITY_DOCUMENTS = 3;

export interface EditorServiceOptions {
  contentDir: string;
  collections: Record<string, AnyCollection>;
  /** The Postgres index a local save updates, if there is one. */
  db?: Database;
  /** Otherwise the static engine's artifact, if the project uses it. */
  staticIndexPath?: string;
  branchId: string;
  mdxTrust?: MdxTrust;
  store?: ContentStore;
  /** Told after a local write changed the index, so the app refreshes its cache. */
  onContentChange?: ContentChangeListener;
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

  /** Where saves land, in the words the workspace reports. */
  get storage(): "local" | "github" | "database" {
    return this.store.kind === "filesystem" ? "local" : this.store.kind;
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
    } catch (error) {
      // Locally: no git, or no repository, so everything reads as published,
      // which is what the editor can act on. Hosted, the failure is GitHub's
      // and the editor should hear it.
      if (this.remote) throw error;
      return new Map();
    }
  }

  private async entries(name: string, actor: StoreActor): Promise<CatalogEntry[]> {
    // A store that is the source of truth lists itself: there may be no
    // checkout at all, and one that exists can be behind.
    if (this.store.entries) {
      const files = await this.store.entries(`${name}/`, actor);
      return files.filter((file) => /\.mdx?$/.test(file.path)).map((file) => this.parsed(file));
    }
    const disk = this.catalog.list(name);
    if (!this.store.overlay) return disk;
    return applyOverlay(disk, await this.store.overlay(actor), name);
  }

  /**
   * The entries plus the ones this person deleted in their draft, read from
   * the published version: a pending deletion stays in the list, marked
   * Deleted, until it is published or restored. Only the person's own
   * deletions come back; one already published is gone.
   */
  private async listed(
    name: string,
    actor: StoreActor,
    changes: ReadonlyMap<string, DraftChange>,
  ): Promise<CatalogEntry[]> {
    const entries = await this.entries(name, actor);
    const present = new Set(entries.map((entry) => entry.path));
    const deleted = [...changes.values()].filter(
      (change) =>
        change.kind === "deleted" &&
        change.path.startsWith(`${name}/`) &&
        /\.mdx?$/.test(change.path) &&
        !present.has(change.path),
    );
    const restored = await Promise.all(
      deleted.map(async (change) => {
        const published = await this.drafts.readPublished(change.path);
        return published ? parseEntry(change.path, published.raw) : null;
      }),
    );
    return [...entries, ...restored.filter((entry): entry is CatalogEntry => entry !== null)];
  }

  /** Every file the entries use, and where: the media library's "Used in". */
  async assetUses(actor: StoreActor): Promise<Map<string, AssetUseDto[]>> {
    const uses = new Map<string, AssetUseDto[]>();
    for (const [name, collection] of Object.entries(this.options.collections)) {
      if (collection.authority === "db-authoritative") continue;
      for (const entry of await this.entries(name, actor)) {
        for (const ref of assetRefsIn(entry.data, "")) {
          const list = uses.get(ref.key) ?? [];
          list.push({
            collection: name,
            slug: entry.slug,
            title: titleOf(entry),
            field: ref.field,
          });
          uses.set(ref.key, list);
        }
      }
    }
    return uses;
  }

  async list(
    name: string,
    fields: SchemaFieldDto[],
    query: EntryQuery,
    actor: StoreActor,
  ): Promise<EntryList> {
    const collection = this.fileCollection(name);
    const changes = await this.changeMap(actor);
    const entries = await this.listed(name, actor, changes);
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

  /** Parsed entries by version: a list re-parses only what changed since the last one. */
  private readonly parsedByVersion = new Map<string, CatalogEntry>();

  private parsed(file: { path: string; raw: string; version: string }): CatalogEntry {
    const key = `${file.path}@${file.version}`;
    const hit = this.parsedByVersion.get(key);
    if (hit) return hit;
    const entry = parseEntry(file.path, file.raw);
    if (this.parsedByVersion.size > 20_000) this.parsedByVersion.clear();
    this.parsedByVersion.set(key, entry);
    return entry;
  }

  /** The path for a slug: the file that declares it, or the conventional one. */
  private async pathFor(name: string, slug: string, actor: StoreActor): Promise<string> {
    // A slug names a file: "shirts/blue" would save a nested file listed
    // under a different slug. Every entry's own slug already has this shape.
    if (!SLUG_RE.test(slug)) throw invalidSlug(slug);
    const changes = await this.changeMap(actor);
    const match = (await this.listed(name, actor, changes)).find((entry) => entry.slug === slug);
    return match?.path ?? `${name}/${slug}.mdx`;
  }

  async read(name: string, slug: string, actor: StoreActor): Promise<EntryDto> {
    this.fileCollection(name);
    const path = await this.pathFor(name, slug, actor);
    const change = (await this.changeMap(actor)).get(path);
    let file = await this.store.read(path, actor);
    let version = file?.version ?? null;
    // Deleted in this person's draft: show the published copy so they can
    // read it or restore it. Its draft version is "absent" (null).
    if (!file && change?.kind === "deleted") {
      file = await this.drafts.readPublished(path);
      version = null;
    }
    if (!file) {
      throw new GraftError({
        code: "DOCUMENT_NOT_FOUND",
        message: `There is no "${slug}" in ${name}.`,
        fix: "It may have been deleted or renamed. Go back to the list and open it again.",
        details: { collection: name, slug },
      });
    }
    const parsed = matter(file.raw, {});
    return {
      collection: name,
      slug,
      path,
      data: parsed.data as Record<string, unknown>,
      body: parsed.content.replace(/^\n/, ""),
      raw: file.raw,
      version,
      status: statusOf(change),
      conflict: change?.conflict ?? false,
    };
  }

  /* ---- writing --------------------------------------------------------- */

  /**
   * Locally a save is live at once: project the files it wrote into the
   * index this Studio has, then tell the app so it drops its cached copy.
   * Only those files: recompiling the tree made one save of a 2,000-product
   * catalog take over a second. A remote draft is neither; the host rebuilds
   * on publish.
   */
  private async afterWrite(paths: string[]): Promise<ContentChangeNotice | undefined> {
    if (this.remote) return undefined;
    const result = await compileIndex(this.options, {
      contentDir: this.options.contentDir,
      paths,
      collections: this.options.collections,
      mdxTrust: this.options.mdxTrust,
      branchId: this.options.branchId,
    });
    // No index at all: the file is the save, and there is nothing to refresh.
    if (!result) return undefined;
    return notifyContentChange(this.options.onContentChange, {
      branch: this.options.branchId,
      gitSha: result.gitSha ?? null,
      changes: result.changes,
    });
  }

  private async written(
    name: string,
    slug: string,
    path: string,
    version: string | null,
    actor: StoreActor,
  ): Promise<SaveEntryResult> {
    const refresh = await this.afterWrite([path]);
    const result = await this.result(name, slug, path, version, actor);
    return refresh ? { ...result, refresh } : result;
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
  async save(input: SaveInput, actor: StoreActor): Promise<SaveEntryResult> {
    const path = await this.pathFor(input.collection, input.slug, actor);
    const { version } = await this.put(input, path, actor);
    return this.written(input.collection, input.slug, path, version, actor);
  }

  /** A save's checks and its write, without the index update that follows. */
  private async put(
    input: SaveInput,
    path: string,
    actor: StoreActor,
  ): Promise<{ version: string | null }> {
    const collection = this.fileCollection(input.collection);
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

    return this.store.write(path, raw, {
      actor,
      ...(input.baseVersion !== undefined ? { baseVersion: input.baseVersion } : {}),
    });
  }

  /**
   * One field set to one value on many entries, from a selection in the list.
   * Each entry is checked and written exactly as a save is, so each becomes a
   * draft; the index is updated once, after the last write. An entry that
   * fails is reported and the others are still saved. `null` removes the
   * field, which only an optional field allows.
   */
  async setField(
    input: { collection: string; slugs: string[]; field: string; value: unknown },
    actor: StoreActor,
  ): Promise<SetFieldResultDto> {
    const collection = this.fileCollection(input.collection);
    const names = collection
      .describe()
      .fields.map((field) => field.name)
      .filter((name) => name !== "slug");
    if (!names.includes(input.field)) {
      throw new GraftError({
        code: "INPUT_VALIDATION_FAILED",
        message: `"${input.field}" is not a field of ${input.collection} that can be set on many entries.`,
        fix: `Use one of: ${names.join(", ")}.`,
        details: { collection: input.collection, field: input.field, fields: names },
      });
    }
    // Paths for every slug from one listing, not one listing per entry.
    const changes = await this.changeMap(actor);
    const paths = new Map(
      (await this.listed(input.collection, actor, changes)).map((entry) => [
        entry.slug,
        entry.path,
      ]),
    );
    const saved: SetFieldResultDto["saved"] = [];
    const failed: SetFieldResultDto["failed"] = [];
    for (const slug of new Set(input.slugs)) {
      try {
        const path = paths.get(slug);
        const file = path ? await this.store.read(path, actor) : null;
        if (!path || !file) {
          throw new GraftError({
            code: "DOCUMENT_NOT_FOUND",
            message: `There is no "${slug}" in ${input.collection}.`,
            fix: "It may have been deleted or renamed. Refresh the list and select it again.",
            details: { collection: input.collection, slug },
          });
        }
        const parsed = matter(file.raw, {});
        const data = { ...(parsed.data as Record<string, unknown>) };
        if (input.value === null) delete data[input.field];
        else data[input.field] = input.value;
        const { version } = await this.put(
          {
            collection: input.collection,
            slug,
            data,
            body: parsed.content.replace(/^\n/, ""),
            baseVersion: file.version,
          },
          path,
          actor,
        );
        saved.push({ slug, path, version });
      } catch (error) {
        if (!(error instanceof GraftError)) throw error;
        failed.push({
          slug,
          error: error.code,
          message: error.message,
          ...(error.fix ? { fix: error.fix } : {}),
        });
      }
    }
    const refresh =
      saved.length > 0 ? await this.afterWrite(saved.map((entry) => entry.path)) : undefined;
    return {
      collection: input.collection,
      field: input.field,
      saved,
      failed,
      ...(refresh ? { refresh } : {}),
    };
  }

  async create(
    input: { collection: string; slug?: string; data: Record<string, unknown>; body?: string },
    actor: StoreActor,
  ): Promise<SaveEntryResult> {
    const collection = this.fileCollection(input.collection);
    // Slugs of entries deleted in this draft stay taken: reusing one would
    // put a new entry beside the pending deletion under the same address.
    const taken = new Set(
      (await this.listed(input.collection, actor, await this.changeMap(actor))).map(
        (entry) => entry.slug,
      ),
    );
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
    return this.written(input.collection, slug, path, version, actor);
  }

  async remove(
    input: { collection: string; slug: string; baseVersion?: string | null },
    actor: StoreActor,
  ): Promise<SaveEntryResult> {
    this.fileCollection(input.collection);
    const path = await this.pathFor(input.collection, input.slug, actor);
    // Locally a deletion is live at once, so one that would leave other
    // entries pointing at nothing is refused before the file goes. Hosted,
    // the publish makes the same check. With no database there is no index,
    // so nothing live points at it.
    if (!this.remote && this.options.db) {
      await checkRemoval({
        db: this.options.db,
        branchId: this.options.branchId,
        collections: this.options.collections,
        paths: [path],
      });
    }
    await this.store.write(path, null, {
      actor,
      ...(input.baseVersion !== undefined ? { baseVersion: input.baseVersion } : {}),
    });
    return this.written(input.collection, input.slug, path, null, actor);
  }

  async duplicate(
    input: { collection: string; slug: string },
    actor: StoreActor,
  ): Promise<SaveEntryResult> {
    const source = await this.read(input.collection, input.slug, actor);
    // Slugs of entries deleted in this draft stay taken: reusing one would
    // put a new entry beside the pending deletion under the same address.
    const taken = new Set(
      (await this.listed(input.collection, actor, await this.changeMap(actor))).map(
        (entry) => entry.slug,
      ),
    );
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
    return {
      publish: this.publishAction(canPublishDirectly),
      canPublish: this.remote || canPublishDirectly,
      changes: described,
      reviews,
    };
  }

  async diff(path: string, actor: StoreActor): Promise<DraftDiffDto> {
    const [before, after] = await Promise.all([
      this.drafts.readPublished(path),
      this.store.read(path, actor),
    ]);
    return compare(path, before?.raw ?? null, after?.raw ?? null);
  }

  /* ---- history ---------------------------------------------------------- */

  /** Where history comes from: the store, or locally the checkout's git log. */
  private get historySource(): LocalHistory | null {
    const { store } = this;
    if (store.history && store.readVersion && store.activity) {
      return {
        history: store.history.bind(store),
        readVersion: store.readVersion.bind(store),
        activity: store.activity.bind(store),
      };
    }
    return this.remote ? null : localHistory(this.options.contentDir);
  }

  /** Why there is no history to show, or null when there is. */
  private async noHistory(): Promise<string | null> {
    if (!this.historySource) return "This storage keeps no history.";
    const { available, reason } = await this.history();
    return available ? null : (reason ?? "There is no history here yet.");
  }

  /** What was published for one document, newest first. */
  async versions(path: string): Promise<VersionListDto> {
    const reason = await this.noHistory();
    const source = this.historySource;
    if (reason !== null || !source) {
      return { available: false, reason: reason ?? "", versions: [] };
    }
    const entries = await source.history(path, { limit: 50 });
    return {
      available: true,
      versions: entries.map((entry) => ({
        id: entry.id,
        at: entry.at,
        ...(entry.by ? { by: entry.by } : {}),
        ...(entry.byKind ? { byKind: entry.byKind } : {}),
        ...(entry.message ? { message: entry.message } : {}),
        ...(entry.version === null ? { deleted: true } : {}),
      })),
    };
  }

  /** One version's bytes, and how what the editor has now differs from it. */
  async version(path: string, id: string, actor: StoreActor): Promise<VersionDetailDto> {
    const source = this.historySource;
    if (!source) {
      throw new GraftError({
        code: "DOCUMENT_NOT_FOUND",
        message: "This storage keeps no history to read a version from.",
        fix: "Restore it from wherever this content's history is kept.",
        details: { path, id },
      });
    }
    const [then, now] = await Promise.all([
      source.readVersion(path, id),
      this.store.read(path, actor),
    ]);
    return {
      id,
      path,
      raw: then?.raw ?? null,
      diff: compare(path, then?.raw ?? null, now?.raw ?? null),
    };
  }

  /** What was published lately, across the content. */
  async activity(limit = 20): Promise<ActivityDto> {
    const reason = await this.noHistory();
    const source = this.historySource;
    if (reason !== null || !source) {
      return { available: false, reason: reason ?? "", events: [] };
    }
    const entries = await source.activity({ limit });
    const events = await Promise.all(
      entries.map(async (entry) => {
        const paths = (entry.paths ?? []).filter((path) => /\.mdx?$/.test(path));
        const shown = paths.slice(0, ACTIVITY_DOCUMENTS);
        const event: ActivityEventDto = {
          id: entry.id,
          at: entry.at,
          documents: await Promise.all(shown.map((path) => this.documentAt(path))),
          more: paths.length - shown.length,
        };
        if (entry.by) event.by = entry.by;
        if (entry.byKind) event.byKind = entry.byKind;
        if (entry.message) event.message = entry.message;
        return event;
      }),
    );
    return { available: true, events };
  }

  /** A path as an entry to link to: its slug and title now, if it still exists. */
  private async documentAt(path: string): Promise<ActivityDocumentDto> {
    const collection = path.split("/")[0] ?? "";
    const name =
      path
        .split("/")
        .pop()
        ?.replace(/\.mdx?$/, "") ?? path;
    const file = await this.drafts.readPublished(path).catch(() => null);
    if (!file) return { path, collection, title: name };
    const entry = parseEntry(path, file.raw);
    return { path, collection, slug: entry.slug, title: titleOf(entry) };
  }

  async publish(
    input: { paths: string[]; message?: string; resolve?: Record<string, "mine" | "theirs"> },
    actor: StoreActor,
    canPublishDirectly: boolean,
  ): Promise<PublishResultDto> {
    const action = this.publishAction(canPublishDirectly);
    // Hosted on GitHub or the database, a person without publish rights
    // submits for review. Locally there is no review: a commit lands on the
    // checkout at once, so it is an editor's to make.
    if (!this.remote && !canPublishDirectly) {
      throw new GraftError({
        code: "UNAUTHORIZED",
        message: "Your role can save drafts here, but committing them needs an editor.",
        fix: "Ask an editor to commit your changes, or ask an admin to make you an editor under Settings, People.",
        details: { required: "studio:publish", paths: input.paths },
      });
    }
    const message = input.message?.trim() || (await this.messageFor(input.paths, actor));
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
      message,
      ...(input.resolve ? { resolve: input.resolve } : {}),
      ...(this.remote ? { mode: action === "publish" ? "direct" : "review" } : {}),
    });
    const refresh = result.changes ? await this.liveChanged(result.changes) : undefined;
    return {
      // The project's review rule can turn a direct publish into a review.
      action: result.mode === "review" && action === "publish" ? "review" : action,
      ...(result.reviewReasons ? { reviewReasons: result.reviewReasons } : {}),
      ...(result.changes ? { live: true } : {}),
      ...(refresh ? { refresh } : {}),
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

  /** The default message for these paths, by their entries' titles. */
  private async messageFor(paths: string[], actor: StoreActor): Promise<string> {
    const wanted = new Set(paths);
    const { changes } = await this.draftList(actor, true);
    return commitMessageFor(changes.filter((change) => wanted.has(change.path)));
  }

  /** Tell the app a publish changed the live index, so it drops its cached pages. */
  private liveChanged(changes: ChangeSet): Promise<ContentChangeNotice | undefined> {
    return notifyContentChange(this.options.onContentChange, {
      branch: this.options.branchId,
      gitSha: null,
      changes,
    });
  }

  async discard(paths: string[], actor: StoreActor): Promise<ContentChangeNotice | undefined> {
    await this.drafts.discard(actor, paths);
    return this.afterWrite(paths);
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

/** Field by field and line by line: what changed from one copy of a document to the next. */
function compare(path: string, beforeRaw: string | null, afterRaw: string | null): DraftDiffDto {
  const old = beforeRaw === null ? null : parseEntry(path, beforeRaw);
  const next = afterRaw === null ? null : parseEntry(path, afterRaw);
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
    file: lineDiff(path, beforeRaw, afterRaw),
  };
}

const ASSET_KEY = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/;

/**
 * The `{ key, alt }` values anywhere in an entry's data, with the field path
 * that holds each: a top-level image, a gallery, an image inside a list of
 * variants. An object counts only when `key` is an asset key and it has no
 * other properties, so a reference or a group with a `key` field doesn't.
 */
export function assetRefsIn(value: unknown, path: string): Array<{ key: string; field: string }> {
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => assetRefsIn(item, path ? `${path}.${i}` : String(i)));
  }
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    typeof record.key === "string" &&
    ASSET_KEY.test(record.key) &&
    keys.every((k) => k === "key" || k === "alt")
  ) {
    return [{ key: record.key, field: path }];
  }
  return keys.flatMap((k) => assetRefsIn(record[k], path ? `${path}.${k}` : k));
}
