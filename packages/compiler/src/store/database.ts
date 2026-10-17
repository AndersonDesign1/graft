/**
 * The content store for a database-sourced project: Postgres is where
 * authored content lives, and publishing puts it live in the same step.
 *
 * A save is a draft revision, shared by everyone editing that document and
 * attributed to whoever wrote it. Publishing validates the drafts with the
 * same checks a compile makes, then moves them live and updates the index in
 * one transaction, so the site can serve a publish without a rebuild. Files
 * on disk play no part: `graft pull` writes them from the published
 * revisions when a developer wants them.
 */
import { GraftError } from "@usegraft/contracts";
import type { AnyCollection } from "@usegraft/core";
import {
  createReview,
  currentFiles,
  discardDrafts,
  draftHeads,
  openReviews,
  publishDrafts,
  publishedHistory,
  readPublishedRevision,
  recentlyPublished,
  readHead,
  readHeads,
  writeDraft,
  type ContentInput,
  type Database,
  type HeadState,
  type LiveDocument,
  type RevisionActor,
} from "@usegraft/db";
import type { MdxTrust } from "@usegraft/mdx-safety";
import { readFrontmatter } from "@usegraft/mdx-safety/frontmatter";
import { validateDocuments, type SourceFile } from "../compile";
import { checkChangedDocuments } from "../references";
import { gitBlobSha } from "./blob";
import { assertBaseVersion } from "./conflict";
import { normalisePath } from "./github/store";
import type {
  ActivityEntry,
  ContentStore,
  DraftChange,
  DraftWorkflow,
  HistoryEntry,
  PublishMode,
  PublishOptions,
  PublishResult,
  ReviewRequest,
  StoreActor,
  StoredFile,
  StoreInfo,
  WriteOptions,
} from "./types";

export interface DatabaseStoreOptions {
  db: Database;
  collections: Record<string, AnyCollection>;
  /** The branch whose revisions this store reads and writes. Default `main`. */
  branchId?: string;
  /** As in compile: what an authored body may contain. Default `restricted`. */
  mdxTrust?: MdxTrust;
  /** How publishing happens for someone allowed to publish. Default `direct`. */
  publishMode?: PublishMode;
  /**
   * Called after drafts went live, with their paths: how a mirror to git
   * runs after every publish. Awaited, so a short-lived process (an MCP
   * call, a CLI command) doesn't exit before it finishes, but its failure
   * doesn't fail the publish: the content is live either way.
   */
  onPublished?: (paths: string[]) => void | Promise<void>;
}

export class DatabaseStore implements ContentStore {
  readonly kind = "database" as const;
  readonly drafts: DraftWorkflow;
  private readonly db: Database;
  private readonly branchId: string;

  constructor(private readonly options: DatabaseStoreOptions) {
    this.db = options.db;
    this.branchId = options.branchId ?? "main";
    this.drafts = {
      changes: () => this.changes(),
      readPublished: (path) => this.readPublished(path),
      publish: (opts) => this.publish(opts),
      discard: (_actor, paths) =>
        discardDrafts(this.db, { branchId: this.branchId, paths: paths.map(normalisePath) }),
      reviews: () => this.reviews(),
    };
  }

  info(): StoreInfo {
    return {
      kind: "database",
      branch: this.branchId,
      publishMode: this.options.publishMode ?? "direct",
    };
  }

  /** The draft when there is one (anyone's: drafts are shared), else the live version. */
  async read(path: string, actor?: StoreActor): Promise<StoredFile | null> {
    const head = await readHead(this.db, this.branchId, normalisePath(path));
    const rev = actor ? (head?.draft ?? head?.published) : head?.published;
    return rev?.raw != null && rev.version ? { raw: rev.raw, version: rev.version } : null;
  }

  async write(
    path: string,
    raw: string | null,
    options: WriteOptions,
  ): Promise<{ version: string | null }> {
    const rel = normalisePath(path);
    const version = raw === null ? null : gitBlobSha(raw);
    const result = await writeDraft(this.db, {
      branchId: this.branchId,
      path: rel,
      raw,
      version,
      actor: revisionActor(options.actor),
      ...(options.baseVersion !== undefined ? { baseVersion: options.baseVersion } : {}),
    });
    if (!result.ok) assertBaseVersion(rel, options.baseVersion, result.current);
    return { version };
  }

  async entries(prefix: string, actor?: StoreActor): Promise<Array<StoredFile & { path: string }>> {
    if (actor) return currentFiles(this.db, this.branchId, prefix);
    const heads = await readHeads(this.db, this.branchId, { prefix });
    return heads.flatMap((head) =>
      head.published?.raw != null && head.published.version
        ? [{ path: head.path, raw: head.published.raw, version: head.published.version }]
        : [],
    );
  }

  /* ---- drafts ---------------------------------------------------------- */

  private async changes(): Promise<DraftChange[]> {
    const heads = await draftHeads(this.db, this.branchId);
    return heads.map((head) => ({
      path: head.path,
      kind: kindOf(head),
      version: head.draft?.version ?? null,
      // One shared draft per document: publishing it can never overwrite a
      // newer live version, because there is no other way to change it.
      conflict: false,
    }));
  }

  private async readPublished(path: string): Promise<StoredFile | null> {
    const head = await readHead(this.db, this.branchId, normalisePath(path));
    const rev = head?.published;
    return rev?.raw != null && rev.version ? { raw: rev.raw, version: rev.version } : null;
  }

  private async publish(options: PublishOptions): Promise<PublishResult> {
    const paths = [...new Set(options.paths.map(normalisePath))];
    if (paths.length === 0) {
      throw new GraftError({
        code: "INPUT_VALIDATION_FAILED",
        message: "Nothing was selected to publish.",
        fix: "Choose at least one changed document.",
      });
    }
    const heads = (await readHeads(this.db, this.branchId, { paths })).filter((head) => head.draft);
    const mode = options.mode ?? this.options.publishMode ?? "direct";
    if (heads.length === 0) {
      return { mode, commit: null, published: [], tookTheirs: [] };
    }

    if (mode === "review") {
      const review = await createReview(this.db, {
        branchId: this.branchId,
        paths: heads.map((head) => head.path),
        title: options.message?.trim() || defaultTitle(heads),
        actor: revisionActor(options.actor),
      });
      // Every draft was published or discarded while the review was filed.
      if (!review) return { mode, commit: null, published: [], tookTheirs: [] };
      // As with a pull request: `published` is what went out, here for review.
      return {
        mode,
        commit: null,
        published: review.paths,
        tookTheirs: [],
        review: {
          id: review.id,
          title: review.title,
          createdAt: review.createdAt.toISOString(),
          paths: review.paths,
          ...(review.requestedByName ? { requestedBy: review.requestedByName } : {}),
        },
      };
    }

    const result = await publishDrafts(this.db, {
      branchId: this.branchId,
      drafts: heads.map((head) => ({ path: head.path, version: head.draft?.version ?? null })),
      actor: revisionActor(options.actor),
      // Checked against the documents live once the content lock is held, so
      // two publishes at once can't each pass against the state before the
      // other: one deleting a category, one pointing a product at it.
      index: (live) => this.indexChanges(heads, live),
      ...(options.message?.trim() ? { message: options.message.trim() } : {}),
    });
    if (!result.ok) {
      throw new GraftError({
        code: "CONTENT_CONFLICT",
        message: `${result.stale.map((p) => `"${p}"`).join(", ")} changed while publishing. Nothing was published.`,
        fix: "Review the latest version of those documents, then publish again.",
        details: { stale: result.stale },
      });
    }
    if (this.options.onPublished) {
      try {
        await this.options.onPublished(result.published);
      } catch (error) {
        console.error(
          `graft: after publish: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return {
      mode,
      commit: null,
      published: result.published,
      tookTheirs: [],
      changes: result.changes,
    };
  }

  /**
   * The index rows the drafts produce, checked exactly as a compile checks a
   * file: the collection, its schema, slug uniqueness among them, MDX safety
   * and references. A draft that would fail `graft compile` never goes live,
   * and neither does a deletion or a new slug that would make it fail by
   * leaving a live document pointing at nothing.
   */
  private indexChanges(heads: HeadState[], live: LiveDocument[]): IndexChanges {
    const writing: SourceFile[] = [];
    const removals: IndexChanges["removals"] = [];
    for (const head of heads) {
      const draftRaw = head.draft?.raw;
      const liveRaw = head.published?.raw;
      if (draftRaw != null) writing.push({ sourcePath: head.path, raw: draftRaw });
      else if (liveRaw != null) {
        removals.push({
          collection: head.path.split("/")[0] ?? "",
          slug: slugOf(head.path, liveRaw),
        });
      }
    }
    const docs = checkChangedDocuments(
      live,
      new Set(heads.map((head) => head.path)),
      this.options.collections,
      (staying) =>
        validateDocuments(writing, this.options.collections, {
          mdxTrust: this.options.mdxTrust,
          references: staying,
        }),
    );
    return {
      upserts: docs.map((doc) => ({
        collection: doc.collection,
        slug: doc.slug,
        data: doc.data,
        body: doc.body,
        contentHash: doc.contentHash,
        sourcePath: doc.sourcePath,
      })),
      removals,
    };
  }

  /* ---- history ---------------------------------------------------------- */

  async history(path: string, options: { limit?: number } = {}): Promise<HistoryEntry[]> {
    const rows = await publishedHistory(
      this.db,
      this.branchId,
      normalisePath(path),
      options.limit ?? 50,
    );
    return rows.map((row) => ({
      id: row.id,
      at: row.publishedAt.toISOString(),
      by: row.actorName,
      byKind: row.actorKind,
      ...(row.message ? { message: row.message } : {}),
      version: row.version,
    }));
  }

  async readVersion(path: string, id: string): Promise<StoredFile | null> {
    const row = await readPublishedRevision(this.db, this.branchId, normalisePath(path), id);
    if (row === undefined) throw versionNotFound(path, id);
    return row.raw === null ? null : { raw: row.raw, version: row.version ?? gitBlobSha(row.raw) };
  }

  /**
   * Publishes, newest first. Revisions that went live in one publish share
   * its moment and its publisher, so they read as one entry.
   */
  async activity(options: { limit?: number } = {}): Promise<ActivityEntry[]> {
    const limit = options.limit ?? 20;
    const rows = await recentlyPublished(this.db, this.branchId, limit * 10);
    const entries: ActivityEntry[] = [];
    let last: { key: string; entry: ActivityEntry & { paths: string[] } } | undefined;
    for (const row of rows) {
      const key = `${row.publishedAt.toISOString()} ${row.publishedBy ?? ""}`;
      if (last?.key === key) {
        last.entry.paths.push(row.path);
        continue;
      }
      if (entries.length === limit) break;
      const entry = {
        id: row.id,
        at: row.publishedAt.toISOString(),
        by: row.publishedBy ?? row.actorName,
        byKind: row.actorKind,
        ...(row.message ? { message: row.message } : {}),
        paths: [row.path],
      };
      entries.push(entry);
      last = { key, entry };
    }
    return entries;
  }

  private async reviews(): Promise<ReviewRequest[]> {
    const rows = await openReviews(this.db, this.branchId);
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      createdAt: row.createdAt.toISOString(),
      paths: row.paths,
      ...(row.requestedByName ? { requestedBy: row.requestedByName } : {}),
    }));
  }
}

function versionNotFound(path: string, id: string): GraftError {
  return new GraftError({
    code: "DOCUMENT_NOT_FOUND",
    message: `"${path}" has no published version ${id}.`,
    fix: "Pick a version from the document's history.",
    details: { path, id },
  });
}

interface IndexChanges {
  upserts: ContentInput[];
  removals: Array<{ collection: string; slug: string }>;
}

function kindOf(head: HeadState): DraftChange["kind"] {
  if (head.draft?.raw == null) return "deleted";
  return head.published?.raw == null ? "added" : "modified";
}

function revisionActor(actor: StoreActor): RevisionActor {
  return {
    id: actor.id,
    ...(actor.name ? { name: actor.name } : {}),
    ...(actor.email ? { email: actor.email } : {}),
    ...(actor.kind ? { kind: actor.kind } : {}),
  };
}

/** The slug a published file was indexed under: its `slug` field, else its file name. */
function slugOf(path: string, raw: string): string {
  const base =
    path
      .split("/")
      .pop()
      ?.replace(/\.mdx?$/, "") ?? path;
  try {
    const { data } = readFrontmatter(raw, path);
    const slug = data.slug;
    return typeof slug === "string" && slug.length > 0 ? slug : base;
  } catch {
    return base;
  }
}

function defaultTitle(heads: HeadState[]): string {
  const names = heads.map(
    (head) =>
      head.path
        .split("/")
        .pop()
        ?.replace(/\.mdx?$/, "") ?? head.path,
  );
  return names.length <= 3 ? `Review ${names.join(", ")}` : `Review ${names.length} documents`;
}
