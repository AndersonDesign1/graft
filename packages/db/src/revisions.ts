/**
 * Authored content in a database-sourced project: drafts, publishing and the
 * revisions behind them.
 *
 * Each path has one head row holding its live revision and its draft. Every
 * write locks that row first, so the version check and the write it guards
 * are one compare-and-swap: two tabs, two people or an agent saving the same
 * document are serialised, and the loser hears about it instead of silently
 * overwriting. There is one draft per document, shared by everyone, as in a
 * hosted CMS; each revision records who wrote it.
 *
 * Versions are computed by the caller (the git blob SHA of the bytes, as on
 * every content store), so this module never has to agree with the compiler
 * on hashing.
 */
import { GraftError, type ChangeSet } from "@usegraft/contracts";
import { and, asc, eq, gte, inArray, isNotNull, isNull, like, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database } from "./client";
import type { ContentInput } from "./diff";
import {
  compilations,
  contentHeads,
  contentIndex,
  contentMirror,
  contentReviews,
  contentRevisions,
} from "./schema";

/** Who wrote a revision. Established by the server, never by the request. */
export interface RevisionActor {
  id: string;
  name?: string;
  email?: string;
  kind?: "human" | "agent";
}

export interface RevisionRef {
  id: string;
  /** Null: this revision deletes the file. */
  raw: string | null;
  version: string | null;
  actorId: string;
  actorName: string | null;
  updatedAt: Date;
}

export interface HeadState {
  path: string;
  published: RevisionRef | null;
  draft: RevisionRef | null;
}

export interface CurrentFile {
  path: string;
  raw: string;
  version: string;
}

/** The version someone editing this path starts from: the draft, else the live one. */
export function currentVersion(head: HeadState | undefined): string | null {
  if (!head) return null;
  return head.draft ? head.draft.version : (head.published?.version ?? null);
}

/** The live version of a path; null when it was never published or the live revision deletes it. */
export function publishedVersion(head: HeadState | undefined): string | null {
  return head?.published?.version ?? null;
}

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Reader = Database | Tx;

const published = alias(contentRevisions, "published");
const draft = alias(contentRevisions, "draft");

function headSelect(db: Reader) {
  return db
    .select({
      path: contentHeads.path,
      pId: published.id,
      pRaw: published.raw,
      pVersion: published.version,
      pActorId: published.actorId,
      pActorName: published.actorName,
      pUpdatedAt: published.updatedAt,
      dId: draft.id,
      dRaw: draft.raw,
      dVersion: draft.version,
      dActorId: draft.actorId,
      dActorName: draft.actorName,
      dUpdatedAt: draft.updatedAt,
    })
    .from(contentHeads)
    .leftJoin(published, eq(published.id, contentHeads.publishedId))
    .leftJoin(draft, eq(draft.id, contentHeads.draftId));
}

type HeadRow = Awaited<ReturnType<ReturnType<typeof headSelect>["execute"]>>[number];

function toHead(row: HeadRow): HeadState {
  return {
    path: row.path,
    published:
      row.pId === null
        ? null
        : {
            id: row.pId,
            raw: row.pRaw,
            version: row.pVersion,
            actorId: row.pActorId as string,
            actorName: row.pActorName,
            updatedAt: row.pUpdatedAt as Date,
          },
    draft:
      row.dId === null
        ? null
        : {
            id: row.dId,
            raw: row.dRaw,
            version: row.dVersion,
            actorId: row.dActorId as string,
            actorName: row.dActorName,
            updatedAt: row.dUpdatedAt as Date,
          },
  };
}

/** Heads for some paths, or every path under a prefix (`products/`), or all of them. */
export async function readHeads(
  db: Reader,
  branchId: string,
  scope: { paths?: string[]; prefix?: string } = {},
): Promise<HeadState[]> {
  if (scope.paths && scope.paths.length === 0) return [];
  const rows = await headSelect(db)
    .where(
      and(
        eq(contentHeads.branchId, branchId),
        scope.paths ? inArray(contentHeads.path, scope.paths) : undefined,
        scope.prefix ? like(contentHeads.path, `${escapeLike(scope.prefix)}%`) : undefined,
      ),
    )
    .orderBy(asc(contentHeads.path));
  return rows.map(toHead);
}

export async function readHead(
  db: Reader,
  branchId: string,
  path: string,
): Promise<HeadState | undefined> {
  return (await readHeads(db, branchId, { paths: [path] }))[0];
}

/** What an editor sees under a prefix: each path's draft, else its live revision, without deletions. */
export async function currentFiles(
  db: Reader,
  branchId: string,
  prefix?: string,
): Promise<CurrentFile[]> {
  const heads = await readHeads(db, branchId, prefix ? { prefix } : {});
  const files: CurrentFile[] = [];
  for (const head of heads) {
    const rev = head.draft ?? head.published;
    if (rev?.raw != null && rev.version) {
      files.push({ path: head.path, raw: rev.raw, version: rev.version });
    }
  }
  return files;
}

/** Every live file on a branch: what `graft compile` and `graft pull` read. */
export async function publishedFiles(db: Reader, branchId: string): Promise<CurrentFile[]> {
  const rows = await db
    .select({ path: contentHeads.path, raw: published.raw, version: published.version })
    .from(contentHeads)
    .innerJoin(published, eq(published.id, contentHeads.publishedId))
    .where(and(eq(contentHeads.branchId, branchId), isNotNull(published.raw)))
    .orderBy(asc(contentHeads.path));
  return rows.map((row) => ({
    path: row.path,
    raw: row.raw as string,
    version: row.version as string,
  }));
}

export interface WriteDraftInput {
  branchId: string;
  path: string;
  /** Null deletes the file in the draft. */
  raw: string | null;
  /** The version of `raw`; null with a deletion. */
  version: string | null;
  actor: RevisionActor;
  /**
   * The version the writer read. A string or null must equal the current
   * version or nothing is written; omitted writes unconditionally.
   */
  baseVersion?: string | null;
  /**
   * Saves by the same person within this many milliseconds of their last one
   * update that draft in place, so history shows sittings, not keystrokes.
   */
  coalesceMs?: number;
}

export type WriteDraftResult =
  | { ok: true; version: string | null }
  | { ok: false; current: string | null };

const DEFAULT_COALESCE_MS = 10 * 60 * 1000;

/**
 * Serialise everything that changes what a branch has published: publishing,
 * importing, and a compile from the revisions. Held to the end of the
 * transaction. Saving drafts doesn't take it, so editing is never blocked.
 */
export async function lockContent(tx: Tx, branchId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`graft-content:${branchId}`}))`);
}

/** Lock a path's head, creating it when the path is new. */
async function lockHead(tx: Tx, branchId: string, path: string): Promise<HeadState> {
  await tx.insert(contentHeads).values({ branchId, path }).onConflictDoNothing();
  await tx
    .select({ path: contentHeads.path })
    .from(contentHeads)
    .where(and(eq(contentHeads.branchId, branchId), eq(contentHeads.path, path)))
    .for("update");
  return (await readHead(tx, branchId, path)) as HeadState;
}

async function dropHeadIfEmpty(tx: Tx, branchId: string, path: string): Promise<void> {
  await tx
    .delete(contentHeads)
    .where(
      and(
        eq(contentHeads.branchId, branchId),
        eq(contentHeads.path, path),
        isNull(contentHeads.publishedId),
        isNull(contentHeads.draftId),
      ),
    );
}

/** Save a draft. Refused (nothing written) when `baseVersion` is stale. */
export async function writeDraft(db: Database, input: WriteDraftInput): Promise<WriteDraftResult> {
  const coalesceMs = input.coalesceMs ?? DEFAULT_COALESCE_MS;
  return db.transaction(async (tx) => {
    const head = await lockHead(tx, input.branchId, input.path);
    const current = currentVersion(head);
    if (input.baseVersion !== undefined && input.baseVersion !== current) {
      await dropHeadIfEmpty(tx, input.branchId, input.path);
      return { ok: false, current } as const;
    }
    if (input.version === current) {
      await dropHeadIfEmpty(tx, input.branchId, input.path);
      return { ok: true, version: input.version } as const;
    }

    const where = and(eq(contentHeads.branchId, input.branchId), eq(contentHeads.path, input.path));

    // Back to exactly what is live: there is nothing left to publish.
    if (input.version === publishedVersion(head) && head.published) {
      await tx
        .update(contentHeads)
        .set({ draftId: null, updatedAt: sql`now()` })
        .where(where);
      return { ok: true, version: input.version } as const;
    }
    // Deleting something that was only ever a draft.
    if (input.raw === null && !head.published) {
      await tx
        .update(contentHeads)
        .set({ draftId: null, updatedAt: sql`now()` })
        .where(where);
      await dropHeadIfEmpty(tx, input.branchId, input.path);
      return { ok: true, version: null } as const;
    }

    const sameSitting =
      head.draft !== null &&
      head.draft.actorId === input.actor.id &&
      Date.now() - head.draft.updatedAt.getTime() < coalesceMs;
    if (sameSitting && head.draft) {
      await tx
        .update(contentRevisions)
        .set({ raw: input.raw, version: input.version, updatedAt: sql`now()` })
        .where(eq(contentRevisions.id, head.draft.id));
      await tx
        .update(contentHeads)
        .set({ updatedAt: sql`now()` })
        .where(where);
      return { ok: true, version: input.version } as const;
    }

    const [row] = await tx
      .insert(contentRevisions)
      .values({
        branchId: input.branchId,
        path: input.path,
        raw: input.raw,
        version: input.version,
        parentId: head.draft?.id ?? head.published?.id ?? null,
        actorKind: input.actor.kind ?? "human",
        actorId: input.actor.id,
        actorName: input.actor.name ?? null,
        actorEmail: input.actor.email ?? null,
      })
      .returning({ id: contentRevisions.id });
    await tx
      .update(contentHeads)
      .set({ draftId: row?.id ?? null, updatedAt: sql`now()` })
      .where(where);
    return { ok: true, version: input.version } as const;
  });
}

export interface PublishDraftsInput {
  branchId: string;
  /** Each path with the draft version the caller validated. */
  drafts: Array<{ path: string; version: string | null }>;
  actor: RevisionActor;
  /**
   * The index rows the published drafts produce, validated by the caller
   * against the schema before this runs. Applied in the same transaction, so
   * the live site never shows a revision that is not the published one.
   */
  index: { upserts: ContentInput[]; removals: Array<{ collection: string; slug: string }> };
  message?: string;
}

export type PublishDraftsResult =
  | { ok: true; changes: ChangeSet; published: string[] }
  | { ok: false; stale: string[] };

/**
 * Publish drafts: each becomes the live revision, and the index changes with
 * it. Refused, with nothing written, when any draft changed after the caller
 * read and validated it.
 */
export async function publishDrafts(
  db: Database,
  input: PublishDraftsInput,
): Promise<PublishDraftsResult> {
  return db.transaction(async (tx) => {
    await lockContent(tx, input.branchId);
    const stale: string[] = [];
    const moving: Array<{ path: string; draftId: string }> = [];
    for (const wanted of input.drafts) {
      const head = await lockHead(tx, input.branchId, wanted.path);
      if (!head.draft || head.draft.version !== wanted.version) {
        stale.push(wanted.path);
        await dropHeadIfEmpty(tx, input.branchId, wanted.path);
        continue;
      }
      moving.push({ path: wanted.path, draftId: head.draft.id });
    }
    // Checked for every path before anything moves, so a refusal publishes
    // none of them: a set of documents goes live together or not at all.
    if (stale.length > 0) return { ok: false, stale } as const;

    for (const move of moving) {
      await tx
        .update(contentRevisions)
        .set({
          publishedAt: sql`now()`,
          publishedById: input.actor.id,
          publishedByName: input.actor.name ?? null,
          ...(input.message ? { message: input.message } : {}),
        })
        .where(eq(contentRevisions.id, move.draftId));
      await tx
        .update(contentHeads)
        .set({ publishedId: move.draftId, draftId: null, updatedAt: sql`now()` })
        .where(and(eq(contentHeads.branchId, input.branchId), eq(contentHeads.path, move.path)));
    }

    const published = moving.map((move) => move.path);
    const changes = await projectEntries(tx, input.branchId, input.index, published);
    if (published.length === 0) return { ok: true, changes, published } as const;
    // A review is answered once everything in it is live, by whichever
    // route it got there: approved from the inbox, or published directly.
    await tx
      .update(contentReviews)
      .set({ status: "published", decidedById: input.actor.id, decidedAt: sql`now()` })
      .where(
        and(
          eq(contentReviews.branchId, input.branchId),
          eq(contentReviews.status, "open"),
          sql`${contentReviews.paths} ?| array[${sql.join(
            published.map((path) => sql`${path}`),
            sql`, `,
          )}]::text[]`,
          sql`not exists (
            select 1 from ${contentHeads}
            where ${contentHeads.branchId} = ${contentReviews.branchId}
              and ${contentHeads.draftId} is not null
              and ${contentReviews.paths} ? ${contentHeads.path}
          )`,
        ),
      );
    return { ok: true, changes, published } as const;
  });
}

/**
 * Apply a few index changes without re-reading the whole branch: what a
 * publish of some documents needs, where a full compile would diff thousands.
 * Records a compilation, like every projection.
 */
async function projectEntries(
  tx: Tx,
  branchId: string,
  changes: PublishDraftsInput["index"],
  paths: string[],
): Promise<ChangeSet> {
  const result: ChangeSet = { added: [], changed: [], removed: [], unchanged: 0 };
  const keys = [...changes.upserts, ...changes.removals];
  const existing =
    keys.length === 0
      ? []
      : await tx
          .select({
            collection: contentIndex.collection,
            slug: contentIndex.slug,
            contentHash: contentIndex.contentHash,
            sourcePath: contentIndex.sourcePath,
            deleted: contentIndex.deleted,
          })
          .from(contentIndex)
          .where(
            and(
              eq(contentIndex.branchId, branchId),
              or(
                ...keys.map((key) =>
                  and(eq(contentIndex.collection, key.collection), eq(contentIndex.slug, key.slug)),
                ),
              ),
            ),
          );
  const byKey = new Map(existing.map((row) => [`${row.collection}/${row.slug}`, row]));

  // The index is keyed by slug, so a draft claiming a slug another live file
  // holds would silently replace that file's row. A full compile refuses the
  // same thing as SLUG_NOT_UNIQUE; so does this, and the throw rolls back.
  for (const row of changes.upserts) {
    const prev = byKey.get(`${row.collection}/${row.slug}`);
    if (prev && !prev.deleted && prev.sourcePath !== row.sourcePath) {
      throw new GraftError({
        code: "SLUG_NOT_UNIQUE",
        message: `Slug "${row.slug}" in collection "${row.collection}" is used by both ${prev.sourcePath} and ${row.sourcePath}`,
        fix: "Give one a unique `slug` field, or rename the file. Nothing was published.",
        details: {
          slug: row.slug,
          collection: row.collection,
          files: [prev.sourcePath, row.sourcePath],
        },
      });
    }
  }

  for (const row of changes.upserts) {
    const key = `${row.collection}/${row.slug}`;
    const prev = byKey.get(key);
    if (!prev || prev.deleted) result.added.push(key);
    else if (prev.contentHash !== row.contentHash || prev.sourcePath !== row.sourcePath) {
      result.changed.push(key);
    } else {
      result.unchanged += 1;
      continue;
    }
    await tx
      .insert(contentIndex)
      .values({ ...row, branchId, deleted: false })
      .onConflictDoUpdate({
        target: [contentIndex.branchId, contentIndex.collection, contentIndex.slug],
        set: {
          data: sql`excluded.data`,
          body: sql`excluded.body`,
          contentHash: sql`excluded.content_hash`,
          sourcePath: sql`excluded.source_path`,
          deleted: false,
          updatedAt: sql`now()`,
        },
      });
  }
  for (const removal of changes.removals) {
    const key = `${removal.collection}/${removal.slug}`;
    const prev = byKey.get(key);
    if (!prev || prev.deleted) continue;
    result.removed.push(key);
    await tx
      .update(contentIndex)
      .set({ deleted: true, updatedAt: sql`now()` })
      .where(
        and(
          eq(contentIndex.branchId, branchId),
          eq(contentIndex.collection, removal.collection),
          eq(contentIndex.slug, removal.slug),
        ),
      );
  }

  // A published file whose slug changed leaves its old row behind: whatever
  // a published path no longer produces comes off the live site.
  const kept = new Set(changes.upserts.map((row) => `${row.collection}/${row.slug}`));
  const stale =
    paths.length === 0
      ? []
      : await tx
          .select({ collection: contentIndex.collection, slug: contentIndex.slug })
          .from(contentIndex)
          .where(
            and(
              eq(contentIndex.branchId, branchId),
              eq(contentIndex.deleted, false),
              inArray(contentIndex.sourcePath, paths),
            ),
          );
  for (const row of stale) {
    const key = `${row.collection}/${row.slug}`;
    if (kept.has(key)) continue;
    result.removed.push(key);
    await tx
      .update(contentIndex)
      .set({ deleted: true, updatedAt: sql`now()` })
      .where(
        and(
          eq(contentIndex.branchId, branchId),
          eq(contentIndex.collection, row.collection),
          eq(contentIndex.slug, row.slug),
        ),
      );
  }

  const [live] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(contentIndex)
    .where(and(eq(contentIndex.branchId, branchId), eq(contentIndex.deleted, false)));
  await tx.insert(compilations).values({
    branchId,
    gitSha: null,
    docCount: live?.n ?? 0,
    added: result.added.length,
    changed: result.changed.length,
    removed: result.removed.length,
  });
  return result;
}

/** Throw drafts away; the live revisions stand. A never-published entry disappears. */
export async function discardDrafts(
  db: Database,
  input: { branchId: string; paths: string[] },
): Promise<void> {
  if (input.paths.length === 0) return;
  await db.transaction(async (tx) => {
    for (const path of input.paths) {
      await lockHead(tx, input.branchId, path);
      await tx
        .update(contentHeads)
        .set({ draftId: null, updatedAt: sql`now()` })
        .where(and(eq(contentHeads.branchId, input.branchId), eq(contentHeads.path, path)));
      await dropHeadIfEmpty(tx, input.branchId, path);
    }
    // A discarded path is no longer asking for review. Take it out of open
    // requests, and close a request with nothing left: it was withdrawn, not
    // published, and must not later read as published.
    const discarded = sql`array[${sql.join(
      input.paths.map((path) => sql`${path}`),
      sql`, `,
    )}]::text[]`;
    await tx
      .update(contentReviews)
      .set({ paths: sql`${contentReviews.paths} - ${discarded}` })
      .where(
        and(
          eq(contentReviews.branchId, input.branchId),
          eq(contentReviews.status, "open"),
          sql`${contentReviews.paths} ?| ${discarded}`,
        ),
      );
    await tx
      .update(contentReviews)
      .set({ status: "closed", decidedAt: sql`now()` })
      .where(
        and(
          eq(contentReviews.branchId, input.branchId),
          eq(contentReviews.status, "open"),
          sql`jsonb_array_length(${contentReviews.paths}) = 0`,
        ),
      );
  });
}

/** Paths with a draft, with what publishing each would do. */
export async function draftHeads(db: Reader, branchId: string): Promise<HeadState[]> {
  const rows = await headSelect(db)
    .where(and(eq(contentHeads.branchId, branchId), isNotNull(contentHeads.draftId)))
    .orderBy(asc(contentHeads.path));
  return rows.map(toHead);
}

/* ---- review requests --------------------------------------------------- */

export interface ContentReview {
  id: string;
  paths: string[];
  title: string;
  requestedById: string;
  requestedByName: string | null;
  createdAt: Date;
}

/**
 * File a review for the paths that still have a draft, or return null when
 * none does: someone else published or discarded them first. The heads are
 * locked while it checks, so the review never names a path whose draft is
 * gone by the time it is written.
 */
export async function createReview(
  db: Database,
  input: { branchId: string; paths: string[]; title: string; actor: RevisionActor },
): Promise<ContentReview | null> {
  return db.transaction(async (tx) => {
    const drafted: string[] = [];
    for (const path of input.paths) {
      const head = await lockHead(tx, input.branchId, path);
      if (head.draft) drafted.push(path);
      else await dropHeadIfEmpty(tx, input.branchId, path);
    }
    if (drafted.length === 0) return null;
    const [row] = await tx
      .insert(contentReviews)
      .values({
        branchId: input.branchId,
        paths: drafted,
        title: input.title,
        requestedById: input.actor.id,
        requestedByName: input.actor.name ?? null,
      })
      .returning();
    return row ? toReview(row) : null;
  });
}

export async function openReviews(db: Reader, branchId: string): Promise<ContentReview[]> {
  const rows = await db
    .select()
    .from(contentReviews)
    .where(and(eq(contentReviews.branchId, branchId), eq(contentReviews.status, "open")))
    .orderBy(asc(contentReviews.createdAt));
  return rows.map(toReview);
}

function toReview(row: typeof contentReviews.$inferSelect): ContentReview {
  return {
    id: row.id,
    paths: row.paths,
    title: row.title,
    requestedById: row.requestedById,
    requestedByName: row.requestedByName,
    createdAt: row.createdAt,
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export interface ImportFile {
  path: string;
  /** Null makes the live revision a deletion. */
  raw: string | null;
  version: string | null;
  /**
   * The live version the caller's copy was based on (`graft push` reads it
   * from the last pull). When set, a path whose live version moved since is
   * refused and nothing is written. Omitted: a path already published
   * keeps what it has, unless the input says `replace`.
   */
  expected?: string | null;
}

export interface ImportInput {
  branchId: string;
  files: ImportFile[];
  /** Write files with no base version over what is published (`graft push --force`). */
  replace?: boolean;
  actor: RevisionActor;
  message?: string;
}

export type ImportResult =
  | {
      ok: true;
      /** Paths whose live revision is now the file's bytes (or a deletion). */
      imported: string[];
      /** Paths whose live revision already held exactly these bytes. */
      unchanged: string[];
      /** Paths an import found already published with other bytes, left as they are. */
      kept: string[];
    }
  | {
      ok: false;
      /** Paths published by someone else since the caller's copy was taken. */
      stale: Array<{ path: string; expected: string | null; current: string | null }>;
    };

/**
 * Make files live revisions: how a project switching to the database
 * source loads its files (an import), and what `graft push` lands.
 * An import only brings in paths with nothing published, so it is safe to
 * re-run; a push names the version each file was based on and overwrites
 * only when nobody published since. A path with no file is left alone, and
 * a draft on a path stays on top of the new live revision, so nobody's
 * unpublished work is lost. The caller validates the files and recompiles
 * the index afterwards.
 */
export async function importPublished(db: Database, input: ImportInput): Promise<ImportResult> {
  return db.transaction(async (tx) => {
    await lockContent(tx, input.branchId);
    const imported: string[] = [];
    const unchanged: string[] = [];
    const kept: string[] = [];
    const heads = new Map<string, HeadState>();
    const stale: Array<{ path: string; expected: string | null; current: string | null }> = [];
    for (const file of input.files) {
      const head = await lockHead(tx, input.branchId, file.path);
      heads.set(file.path, head);
      const current = publishedVersion(head);
      if (file.expected !== undefined && file.expected !== current && file.version !== current) {
        stale.push({ path: file.path, expected: file.expected, current });
      }
    }
    // Checked for every file before any is written, as a publish is.
    if (stale.length > 0) {
      for (const file of input.files) await dropHeadIfEmpty(tx, input.branchId, file.path);
      return { ok: false, stale } as const;
    }
    for (const file of input.files) {
      const head = heads.get(file.path) as HeadState;
      if (publishedVersion(head) === file.version) {
        unchanged.push(file.path);
        await dropHeadIfEmpty(tx, input.branchId, file.path);
        continue;
      }
      // An import (no base version) never overwrites what is published.
      if (file.expected === undefined && !input.replace && head.published) {
        kept.push(file.path);
        continue;
      }
      const [row] = await tx
        .insert(contentRevisions)
        .values({
          branchId: input.branchId,
          path: file.path,
          raw: file.raw,
          version: file.version,
          parentId: head.published?.id ?? null,
          actorKind: input.actor.kind ?? "human",
          actorId: input.actor.id,
          actorName: input.actor.name ?? null,
          actorEmail: input.actor.email ?? null,
          message: input.message ?? null,
          publishedAt: sql`now()`,
          publishedById: input.actor.id,
          publishedByName: input.actor.name ?? null,
        })
        .returning({ id: contentRevisions.id });
      // A draft identical to the bytes now live has nothing left to publish.
      const clearDraft = head.draft?.version === file.version;
      await tx
        .update(contentHeads)
        .set({
          publishedId: row?.id ?? null,
          ...(clearDraft ? { draftId: null } : {}),
          updatedAt: sql`now()`,
        })
        .where(and(eq(contentHeads.branchId, input.branchId), eq(contentHeads.path, file.path)));
      imported.push(file.path);
    }
    return { ok: true, imported, unchanged, kept } as const;
  });
}

/** One publish, for telling a developer what changed since they last looked. */
export interface PublishedChange {
  /** The revision, so a caller polling by time can tell one it has seen. */
  id: string;
  path: string;
  /** Null: the publish deleted the document. */
  version: string | null;
  publishedAt: Date;
  publishedBy: string | null;
  message: string | null;
}

/**
 * Revisions published at or after `since`, oldest first: what `graft dev`
 * announces. At or after, because a JavaScript Date holds milliseconds and
 * Postgres microseconds: a poller passes the last time it saw and drops the
 * ids it already announced.
 */
export async function publishedSince(
  db: Reader,
  branchId: string,
  since: Date,
): Promise<PublishedChange[]> {
  const rows = await db
    .select({
      id: contentRevisions.id,
      path: contentRevisions.path,
      version: contentRevisions.version,
      publishedAt: contentRevisions.publishedAt,
      publishedBy: contentRevisions.publishedByName,
      publishedById: contentRevisions.publishedById,
      message: contentRevisions.message,
    })
    .from(contentRevisions)
    .where(and(eq(contentRevisions.branchId, branchId), gte(contentRevisions.publishedAt, since)))
    .orderBy(asc(contentRevisions.publishedAt));
  return rows.map((row) => ({
    id: row.id,
    path: row.path,
    version: row.version,
    publishedAt: row.publishedAt as Date,
    publishedBy: row.publishedBy ?? row.publishedById,
    message: row.message,
  }));
}

/** Every path's live version, deletions included as null: what a mirror compares against. */
export async function liveVersions(
  db: Reader,
  branchId: string,
): Promise<Map<string, string | null>> {
  const rows = await db
    .select({ path: contentHeads.path, version: published.version })
    .from(contentHeads)
    .innerJoin(published, eq(published.id, contentHeads.publishedId))
    .where(eq(contentHeads.branchId, branchId));
  return new Map(rows.map((row) => [row.path, row.version]));
}

/* ---- mirroring to git -------------------------------------------------- */

/** The version the mirror last committed for each path. */
export async function mirroredVersions(
  db: Reader,
  branchId: string,
): Promise<Map<string, string | null>> {
  const rows = await db
    .select({ path: contentMirror.path, version: contentMirror.version })
    .from(contentMirror)
    .where(eq(contentMirror.branchId, branchId));
  return new Map(rows.map((row) => [row.path, row.version]));
}

/** Record what a mirror run committed. */
export async function recordMirrored(
  db: Reader,
  branchId: string,
  entries: Array<{ path: string; version: string | null }>,
  commitSha: string | null,
): Promise<void> {
  if (entries.length === 0) return;
  await db
    .insert(contentMirror)
    .values(entries.map((entry) => ({ branchId, ...entry, commitSha })))
    .onConflictDoUpdate({
      target: [contentMirror.branchId, contentMirror.path],
      set: {
        version: sql`excluded.version`,
        commitSha: sql`excluded.commit_sha`,
        mirroredAt: sql`now()`,
      },
    });
}

/**
 * Run `fn` while holding this branch's mirror lock, or return `undefined`
 * straight away when another process holds it. Two servers mirroring the
 * same publishes at once would race to commit them twice.
 */
export async function withMirrorLock<T>(
  db: Database,
  branchId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T | undefined> {
  return db.transaction(async (tx) => {
    const [row] = await tx.execute<{ locked: boolean }>(
      sql`select pg_try_advisory_xact_lock(hashtext(${`graft-mirror:${branchId}`})) as locked`,
    );
    if (!row?.locked) return undefined;
    return fn(tx);
  });
}
