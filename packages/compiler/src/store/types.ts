/**
 * Where authored content is read from and written to.
 *
 * A save is a save. Whether the bytes land in a file in a checkout or in a
 * commit on a draft branch on GitHub is the store's job, chosen when a surface
 * is mounted. Studio and MCP both write through one, so a hosted agent's
 * `write_content` and a hosted editor's save become the same kind of change.
 *
 * Paths are relative to the content directory, forward slashes
 * (`products/blue-shirt.mdx`). A `version` is the git blob SHA of the bytes,
 * on every store: content-addressed, so it says "these exact bytes" and two
 * stores agree on it.
 */

/** Who a write is attributed to. Established by the server, never the request. */
export interface StoreActor {
  /** Stable identifier: a GitHub login, an email, an OS user. */
  id: string;
  name?: string;
  email?: string;
}

export interface StoredFile {
  raw: string;
  version: string;
}

export interface WriteOptions {
  actor: StoreActor;
  /**
   * The version the caller read before editing.
   *
   * - a string: refuse with CONTENT_CONFLICT unless the current version is this
   * - `null`: the caller believes the file does not exist (a create)
   * - omitted: write unconditionally (last writer wins)
   *
   * This one rule covers a second tab, a second editor, and an agent editing
   * over MCP while a person has the document open.
   */
  baseVersion?: string | null;
}

/** What publishing a path would do to the published content. */
export type DraftChangeKind = "added" | "modified" | "deleted";

export interface DraftChange {
  path: string;
  kind: DraftChangeKind;
  /** The draft's version; null when the draft deletes the file. */
  version: string | null;
  /**
   * The published version changed since the draft began, and differs from
   * the draft. Publishing this path needs a decision: keep mine or take theirs.
   */
  conflict: boolean;
}

export type PublishMode = "direct" | "review";

export interface PublishOptions {
  actor: StoreActor;
  paths: string[];
  /** The commit message. A default naming the documents is used when blank. */
  message?: string;
  /** `review` opens a pull request instead of moving the production branch. */
  mode?: PublishMode;
  /** Per-path resolution for conflicts reported by an earlier attempt. */
  resolve?: Record<string, "mine" | "theirs">;
}

export interface PublishResult {
  mode: PublishMode;
  /** The commit that carries the change, or null when nothing was published. */
  commit: { sha: string; url?: string } | null;
  /** Paths whose draft version was published (or submitted for review). */
  published: string[];
  /** Paths where the published version was kept and the draft discarded. */
  tookTheirs: string[];
  /** The pull request, in review mode. */
  review?: ReviewRequest;
}

export interface ReviewRequest {
  number: number;
  url: string;
  title: string;
  createdAt: string;
}

/**
 * Drafts that are not yet published, and the act of publishing them.
 *
 * The filesystem store has none of its own: locally, uncommitted files ARE
 * the draft, and Studio's git module provides this over the working tree.
 */
export interface DraftWorkflow {
  changes(actor: StoreActor): Promise<DraftChange[]>;
  /** The published bytes of a path, for a diff. Null when unpublished. */
  readPublished(path: string): Promise<StoredFile | null>;
  publish(options: PublishOptions): Promise<PublishResult>;
  /** Throw away the draft for these paths; the published version stands. */
  discard(actor: StoreActor, paths: string[]): Promise<void>;
  /** Changes submitted for review and still open. */
  reviews(actor: StoreActor): Promise<ReviewRequest[]>;
}

export interface StoreInfo {
  kind: "filesystem" | "github";
  /** "owner/name", for a remote store. */
  repository?: string;
  /** The branch publishing lands on. */
  branch?: string;
  /** The default way publishing happens for someone allowed to publish. */
  publishMode?: PublishMode;
  /** A link to the repository, for "View on GitHub". */
  url?: string;
}

export interface ContentStore {
  readonly kind: StoreInfo["kind"];
  info(): StoreInfo;
  /**
   * The bytes an editor should start from: their draft when they have one for
   * this path, otherwise the published version. Null when neither exists.
   */
  read(path: string, actor?: StoreActor): Promise<StoredFile | null>;
  /** Write bytes, or delete the file with `null`. */
  write(
    path: string,
    raw: string | null,
    options: WriteOptions,
  ): Promise<{ version: string | null }>;
  /**
   * Files whose current bytes for this actor differ from the local checkout,
   * with those bytes (null: deleted). Lists read the checkout and apply this,
   * so a list costs one comparison instead of one request per document.
   * Absent on the filesystem store, where the checkout is the truth.
   */
  overlay?(actor?: StoreActor): Promise<Map<string, StoredFile | null>>;
  drafts?: DraftWorkflow;
}
