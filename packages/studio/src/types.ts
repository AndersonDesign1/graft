/** Serializable shapes matching packages/studio/openapi.yaml */

/**
 * Where a document exists relative to the compiled index.
 *
 * Graft content is git-authoritative: the `.mdx` on disk is truth and the
 * Postgres `content_index` is a projection refreshed by `graft compile`. The
 * gap between the two is real operator state, not a loading artifact, so it
 * is modelled explicitly rather than inferred from an empty list.
 */
export type DocumentState =
  /** on disk, in the index, contentHash matches */
  | "synced"
  /** on disk and in the index, hashes differ — edited since the last compile */
  | "drifted"
  /** on disk only — never compiled */
  | "unindexed"
  /** in the index only — the file is gone and the index is stale */
  | "orphaned";

export interface ContentTreeDoc {
  slug: string;
  sourcePath: string;
  title?: string;
  state: DocumentState;
  /** Index row timestamp; absent while a document is still `unindexed`. */
  updatedAt?: string;
  /**
   * Grouping and ordering as the site renders them. Conventional frontmatter
   * (`section`, `order`) — the same fields the docs sidebar sorts on — so the
   * Studio lists documents in publication order by default rather than
   * alphabetically. Absent on collections that don't use them.
   */
  section?: string;
  order?: number;
}

export interface ContentTreeCollection {
  name: string;
  description?: string;
  /** file-authoritative collections live on disk; db ones live in data_records. */
  authority: "file" | "db";
  documents: ContentTreeDoc[];
  /** Documents that are neither `synced` nor (for db collections) applicable. */
  driftCount: number;
  /**
   * Set when this collection alone failed to read (e.g. one unparseable file).
   * The rest of the tree still renders — one bad document must not blank the UI.
   */
  error?: string;
}

export interface ContentTree {
  branch: string;
  collections: ContentTreeCollection[];
  /** Rolled-up counts, so the header and Overview don't each recompute them. */
  summary: {
    documents: number;
    synced: number;
    drifted: number;
    unindexed: number;
    orphaned: number;
    /** drifted + unindexed + orphaned — the "compile would change something" count. */
    drift: number;
  };
}

export interface DocumentDto {
  collection: string;
  slug: string;
  sourcePath: string;
  data: Record<string, unknown>;
  body: string;
  raw: string;
}

export interface CompilationDto {
  id: string;
  branchId: string;
  gitSha: string | null;
  docCount: number;
  added: number;
  changed: number;
  removed: number;
  createdAt: string;
}

export interface CompilationList {
  compilations: CompilationDto[];
}

/**
 * Result of an operator-triggered compile. Named `…Dto` because @usegraft/compiler
 * exports its own richer `CompileResult`; this is the flattened wire shape.
 */
export interface CompileResultDto {
  branch: string;
  gitSha: string | null;
  added: number;
  changed: number;
  removed: number;
  docCount: number;
}

/** Whether reverting to a compilation is safe, and why not if it isn't. */
export interface RevertPreviewDto {
  compilationId: string;
  gitSha: string | null;
  shortSha: string;
  /** The commit exists in this clone. */
  reachable: boolean;
  /** Uncommitted content files a revert would destroy. */
  dirty: string[];
  canRevert: boolean;
  createdAt: string;
}

export interface RevertResultDto {
  compilationId: string;
  gitSha: string | null;
  branch: string;
  /** Content files git restored, relative to the content directory. */
  filesChanged: string[];
  added: number;
  changed: number;
  removed: number;
  docCount: number;
}

/* ---- git: the Changes drawer --------------------------------------------
   Content is git-authoritative, so "what have I changed?" has a real answer
   that no draft table has to invent. These shapes are that answer in the
   editor's vocabulary — git's two status columns collapse to one verb, and
   the index/work-tree split never reaches the wire. */

/** What happened to a file, as an editor would say it. */
export type ChangeStatus = "added" | "modified" | "deleted" | "renamed";

export interface ChangedFileDto {
  /** Relative to the content directory, forward slashes. */
  path: string;
  status: ChangeStatus;
  /** Previous path, on a rename. */
  from?: string;
  /** Part of this change is already in git's index. Shown, never required. */
  staged: boolean;
}

export interface GitChangesDto {
  /**
   * False when git is unavailable or the content directory is not in a work
   * tree. Not an error: content still compiles and serves without git, so the
   * drawer explains rather than the request failing.
   */
  tracked: boolean;
  /** Why not, when `tracked` is false. */
  reason?: string;
  /** The git branch a commit would land on; null when HEAD is detached. */
  gitBranch: string | null;
  /** Short SHA of HEAD; null in a repository with no commits yet. */
  head: string | null;
  files: ChangedFileDto[];
}

export interface DiffLineDto {
  kind: "context" | "add" | "remove";
  text: string;
  oldLine?: number;
  newLine?: number;
}

export interface DiffHunkDto {
  /** The function/section context git prints after the @@ marker, if any. */
  heading: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLineDto[];
}

export interface FileDiffDto {
  path: string;
  /** No diff is shown for binary files; there is nothing to review line by line. */
  binary: boolean;
  hunks: DiffHunkDto[];
  added: number;
  removed: number;
  /** The diff was longer than the drawer renders. */
  truncated: boolean;
}

export interface CommitResultDto {
  /** Null only if HEAD could not be read back after a successful commit. */
  sha: string | null;
  shortSha: string;
  message: string;
  gitBranch: string | null;
  /** Content-relative paths recorded in the commit. */
  files: string[];
}

export interface BranchDto {
  name: string;
  parent: string | null;
  backend: string;
  status: string;
  createdAt: string;
  endpointHost: string | null;
}

export interface BranchList {
  branches: BranchDto[];
}

export interface PendingApprovalDto {
  id: string;
  branchId: string;
  functionName: string;
  input: Record<string, unknown>;
  requestedByKind: string;
  requestedById: string | null;
  correlationId: string;
  createdAt: string;
}

export interface ApprovalList {
  approvals: PendingApprovalDto[];
}

/**
 * One field of a collection schema, for the read-only Schema view.
 * Recursive: object fields carry `fields`, array fields carry `items` — the
 * same shape MCP's describe_schema returns, so the two never drift.
 */
export interface SchemaFieldDto {
  name: string;
  type: string;
  optional: boolean;
  description?: string;
  fields?: SchemaFieldDto[];
  items?: SchemaFieldDto;
}

export interface SchemaCollectionDto {
  name: string;
  description?: string;
  authority: "file" | "db";
  /** Verbatim authority from the descriptor, for the tooltip. */
  authorityRaw: string;
  fields: SchemaFieldDto[];
}

export interface SchemaList {
  collections: SchemaCollectionDto[];
}
