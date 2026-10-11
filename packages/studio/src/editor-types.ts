/**
 * Wire shapes for the editor API (`/workspace`, `/entries`, `/entry`,
 * `/drafts`). Named in the editor's terms: an entry is a document as a person
 * sees it, a draft is an unpublished change, publishing is the act that makes
 * it live. Git, files and the index stay underneath.
 */
import type { ContentChangeNotice, ReviewRequest } from "@usegraft/compiler";

/**
 * Where an entry stands, for this person.
 * - `published`: no unpublished changes
 * - `changed`: edited since it was published
 * - `new`: never published
 * - `deleted`: deleted in the draft, still live until published
 */
export type EntryStatus = "published" | "changed" | "new" | "deleted";

/** A list column's value. Long text is cut; structured values are summarised. */
export type CellValue = string | number | boolean | null;

export interface EntrySummary {
  path: string;
  collection: string;
  slug: string;
  title: string;
  status: EntryStatus;
  conflict: boolean;
  /** Column values by field key, for the fields the list can show. */
  fields: Record<string, CellValue>;
  /** An asset key for a thumbnail, from the first image field. */
  image?: string;
  /** Last written, as the file system knows it. Local only. */
  updatedAt?: string;
  /** The frontmatter could not be read; the entry is listed so it can be fixed. */
  problem?: string;
}

export interface Facet {
  field: string;
  values: { value: string; count: number }[];
}

export interface EntryList {
  collection: string;
  /** Matches after search and filters. */
  total: number;
  items: EntrySummary[];
  /** Pass back as `cursor` for the next page; null on the last. */
  nextCursor: string | null;
  /** Totals for the whole collection, before search and filters. */
  counts: { all: number; unpublished: number };
  /** Values to filter by, for select, boolean and reference fields. */
  facets: Facet[];
}

export interface EntryDto {
  collection: string;
  slug: string;
  path: string;
  data: Record<string, unknown>;
  body: string;
  raw: string;
  /** Pass back as `baseVersion` when saving. Null for an entry being created. */
  version: string | null;
  status: EntryStatus;
  conflict: boolean;
}

export interface SaveEntryResult {
  collection: string;
  slug: string;
  path: string;
  /** The new version, to send as `baseVersion` on the next save. */
  version: string | null;
  status: EntryStatus;
  /** Present when a local save changed the index: whether the app was told to refresh. */
  refresh?: ContentChangeNotice;
}

/** What pressing Publish does for this person. */
export type PublishAction = "commit" | "publish" | "review";

export interface WorkspaceDto {
  /** Where saves land. */
  storage: "local" | "github";
  repository?: string;
  repositoryUrl?: string;
  /** The branch publishing lands on. */
  branch?: string;
  publish: PublishAction;
  canWrite: boolean;
  /** Local: the content directory is under git, so Commit and Discard work. */
  history: boolean;
  /** Why history is unavailable, when it is. */
  historyReason?: string;
  user: {
    id: string;
    name: string | null;
    email: string | null;
    scopes: readonly string[];
  } | null;
  /**
   * Whether this request carried a Studio session cookie, so a Sign out
   * control makes sense. It does not say whether sign-in is configured.
   */
  sessions: boolean;
}

export interface DraftChangeDto {
  path: string;
  collection: string;
  slug: string;
  title: string;
  kind: "added" | "modified" | "deleted";
  conflict: boolean;
}

export interface DraftsDto {
  publish: PublishAction;
  changes: DraftChangeDto[];
  reviews: ReviewRequest[];
}

/** One top-level field that differs between the published version and the draft. */
export interface FieldChangeDto {
  field: string;
  before: unknown;
  after: unknown;
}

/**
 * A draft compared with what is published: the fields that changed, in
 * values an editor recognises, plus the line diff of the file for anyone who
 * wants the exact bytes.
 */
export interface DraftDiffDto {
  path: string;
  fields: FieldChangeDto[];
  bodyChanged: boolean;
  file: import("./types").FileDiffDto;
}

export interface PublishResultDto {
  action: PublishAction;
  published: string[];
  tookTheirs: string[];
  commit: { sha: string; shortSha: string; url?: string } | null;
  review?: ReviewRequest;
}
