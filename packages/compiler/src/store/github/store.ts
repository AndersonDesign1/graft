/**
 * Authored content on GitHub: every editor drafts on their own branch, and
 * publishing lands one commit on the production branch (or opens a pull
 * request). Nothing touches the local filesystem, so a hosted Studio on a
 * read-only serverless filesystem can save.
 *
 * The model, in git terms:
 *
 *   production  ──●──────●───────●  (main)
 *                  \       \
 *   draft           ●──●────◆──●     (graft-studio/drafts/<editor>)
 *                   saves   merge of main, when it cannot clobber anything
 *
 * - `base` is the merge base of draft and production.
 * - `mine` is what the draft changed since base, minus anything production
 *   already has byte for byte (a published draft, or a squash merge of a
 *   review, shows nothing).
 * - `theirs` is what production changed since base.
 * - A path in both whose bytes differ is a conflict. It is never resolved
 *   silently: the draft is only re-based onto production when no such path
 *   exists, and publish refuses until the editor chooses.
 *
 * Every ref update is a fast-forward, never forced, which makes each one a
 * compare-and-swap: two tabs saving at once cannot drop each other's change,
 * one of them retries on the new head.
 *
 * Git objects are immutable and content-addressed, so everything read by SHA
 * is cached for the life of the instance with no invalidation to get wrong.
 */
import { createHash } from "node:crypto";
import { GraftError } from "@usegraft/contracts";
import { gitBlobSha } from "../blob";
import { assertBaseVersion } from "../conflict";
import { trimChar } from "../trim";
import type {
  ContentStore,
  DraftChange,
  DraftWorkflow,
  PublishMode,
  PublishOptions,
  PublishResult,
  ReviewRequest,
  StoreActor,
  StoredFile,
  StoreInfo,
  WriteOptions,
} from "../types";
import type { GitHubAuth } from "./auth";
import { GitHubClient, type CommitAuthor, type NewTreeEntry } from "./client";

export interface GitHubStoreOptions {
  /** "owner/name". */
  repo: string;
  auth: GitHubAuth;
  /** The production branch. Default "main". */
  branch?: string;
  /**
   * Where the content directory sits in the repository, forward slashes, no
   * leading slash. "" when content is the repository root. Default "content".
   */
  contentPath?: string;
  /** What publishing does for someone allowed to publish. Default "direct". */
  publishMode?: PublishMode;
  /**
   * The commit the running deployment was built from. Lists read the local
   * checkout, so the overlay is computed against this; without it the
   * overlay assumes the checkout matches production.
   */
  deployedSha?: string;
  /** Prefix for the branches the store creates. Default "graft-studio". */
  branchPrefix?: string;
  apiUrl?: string;
  fetch?: typeof fetch;
}

/** path (content-relative) -> blob SHA */
type Files = ReadonlyMap<string, string>;

interface DraftState {
  main: string;
  draft: string | null;
  base: string;
  mainFiles: Files;
  baseFiles: Files;
  draftFiles: Files;
  /** path -> draft blob (null: deleted) */
  mine: Map<string, string | null>;
  /** path -> production blob (null: deleted) */
  theirs: Map<string, string | null>;
}

const MAX_ATTEMPTS = 3;
const BLOB_CACHE_LIMIT = 2_000;

export class GitHubStore implements ContentStore {
  readonly kind = "github" as const;
  readonly drafts: DraftWorkflow;
  private readonly client: GitHubClient;
  private readonly branch: string;
  private readonly contentPath: string;
  private readonly prefix: string;
  private readonly publishMode: PublishMode;
  private readonly deployedSha: string | undefined;

  private readonly commits = new Map<string, { tree: string; parents: string[] }>();
  private readonly files = new Map<string, Files>();
  private readonly bases = new Map<string, string>();
  private readonly blobs = new Map<string, string>();

  constructor(options: GitHubStoreOptions) {
    this.client = new GitHubClient({
      repo: options.repo,
      auth: options.auth,
      apiUrl: options.apiUrl,
      fetch: options.fetch,
    });
    this.branch = options.branch ?? "main";
    this.contentPath = trimChar(options.contentPath ?? "content", "/", "both");
    this.prefix = options.branchPrefix ?? "graft-studio";
    this.publishMode = options.publishMode ?? "direct";
    this.deployedSha = options.deployedSha;
    this.drafts = {
      changes: (actor) => this.changes(actor),
      readPublished: (path) => this.readPublished(path),
      publish: (opts) => this.publish(opts),
      discard: (actor, paths) => this.discard(actor, paths),
      reviews: (actor) => this.reviews(actor),
    };
  }

  info(): StoreInfo {
    return {
      kind: "github",
      repository: this.client.repo,
      branch: this.branch,
      publishMode: this.publishMode,
      url: this.client.webUrl(""),
    };
  }

  /** The permission a GitHub user holds on the repository. */
  permissionOf(login: string): Promise<string> {
    return this.client.permissionOf(login);
  }

  /* ---- ContentStore ---------------------------------------------------- */

  async read(path: string, actor?: StoreActor): Promise<StoredFile | null> {
    const rel = normalisePath(path);
    const state = actor ? await this.state(actor) : await this.publishedState();
    const sha = state.mine.has(rel) ? state.mine.get(rel) : state.mainFiles.get(rel);
    if (!sha) return null;
    return { raw: await this.blob(sha), version: sha };
  }

  async write(
    path: string,
    raw: string | null,
    options: WriteOptions,
  ): Promise<{ version: string | null }> {
    const rel = normalisePath(path);
    const branch = this.draftBranch(options.actor);
    const version = raw === null ? null : gitBlobSha(raw);

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const state = await this.state(options.actor);
      // The version the editor was shown is the one read() returns: their
      // draft for a path they changed, otherwise production.
      const current = state.mine.has(rel)
        ? (state.mine.get(rel) ?? null)
        : (state.mainFiles.get(rel) ?? null);
      assertBaseVersion(rel, options.baseVersion, current);
      if (version === current && state.draft !== null) return { version };

      const change: Entry = { path: rel, raw };
      const message = `Draft: ${raw === null ? "delete" : "update"} ${rel}`;
      const author = authorOf(options.actor);

      if (state.draft === null) {
        if (version === current) return { version };
        const commit = await this.commitOnto(state.main, state.mainFiles, [change], {
          parents: [state.main],
          message,
          author,
        });
        if (await this.client.createRef(branch, commit)) return { version };
        continue; // another tab created it first
      }

      // Re-base onto production in the same commit when nothing can be
      // clobbered: a merge commit whose first parent is the draft head is a
      // fast-forward for the draft branch, so the ref update stays a CAS.
      const rebase = state.base !== state.main && !this.hasConflict(state);
      const commit = rebase
        ? await this.commitOnto(state.main, state.mainFiles, [...entriesFor(state.mine), change], {
            parents: [state.draft, state.main],
            message,
            author,
          })
        : await this.commitOnto(state.draft, state.draftFiles, [change], {
            parents: [state.draft],
            message,
            author,
          });
      if (await this.client.fastForward(branch, commit)) return { version };
    }
    throw busy(rel);
  }

  async overlay(actor?: StoreActor): Promise<Map<string, StoredFile | null>> {
    const state = actor ? await this.state(actor) : await this.publishedState();
    const deployed = this.deployedSha ? await this.contentFiles(this.deployedSha) : state.mainFiles;
    const effective = new Map(state.mainFiles);
    for (const [path, sha] of state.mine) {
      if (sha === null) effective.delete(path);
      else effective.set(path, sha);
    }
    const out = new Map<string, StoredFile | null>();
    for (const path of new Set([...deployed.keys(), ...effective.keys()])) {
      const sha = effective.get(path);
      if (sha === deployed.get(path)) continue;
      out.set(path, sha ? { raw: await this.blob(sha), version: sha } : null);
    }
    return out;
  }

  /* ---- drafts ---------------------------------------------------------- */

  private async changes(actor: StoreActor): Promise<DraftChange[]> {
    const state = await this.state(actor);
    return [...state.mine]
      .map(([path, sha]): DraftChange => {
        const published = state.mainFiles.get(path) ?? null;
        return {
          path,
          kind: sha === null ? "deleted" : published === null ? "added" : "modified",
          version: sha,
          conflict: isConflict(state, path),
        };
      })
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  private async readPublished(path: string): Promise<StoredFile | null> {
    const rel = normalisePath(path);
    const main = await this.requireMain();
    const sha = (await this.contentFiles(main)).get(rel);
    return sha ? { raw: await this.blob(sha), version: sha } : null;
  }

  private async publish(options: PublishOptions): Promise<PublishResult> {
    const mode = options.mode ?? this.publishMode;
    const resolve = options.resolve ?? {};
    const requested = [...new Set(options.paths.map(normalisePath))];
    if (requested.length === 0) {
      throw new GraftError({
        code: "INPUT_VALIDATION_FAILED",
        message: "Nothing was selected to publish.",
        fix: "Choose at least one changed document.",
      });
    }

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const state = await this.state(options.actor);
      for (const path of requested) {
        if (!state.mine.has(path)) {
          throw new GraftError({
            code: "INPUT_VALIDATION_FAILED",
            message: `"${path}" has no unpublished changes.`,
            fix: "Reload the list of changes: it may already be published or discarded.",
            details: { path },
          });
        }
      }

      const conflicts = requested.filter(
        (path) => isConflict(state, path) && resolve[path] === undefined,
      );
      if (conflicts.length > 0) {
        throw new GraftError({
          code: "CONTENT_CONFLICT",
          message: `${conflicts.length === 1 ? "A document was" : `${conflicts.length} documents were`} also changed on ${this.branch} since this draft began.`,
          fix: 'Publish again with a resolution per document: "mine" publishes the draft over the newer version, "theirs" keeps the published version and discards the draft.',
          details: { conflicts: conflicts.map((path) => ({ path })) },
        });
      }

      const tookTheirs = requested.filter((path) => resolve[path] === "theirs");
      const publishing = requested.filter((path) => resolve[path] !== "theirs");
      const author = authorOf(options.actor);
      const message = options.message?.trim() || defaultMessage(publishing);

      let commit: string | null = null;
      let review: ReviewRequest | undefined;
      if (publishing.length > 0) {
        const entries = publishing.map((path) => ({
          path,
          sha: state.mine.get(path) ?? null,
        }));
        commit = await this.commitOnto(state.main, state.mainFiles, entries, {
          parents: [state.main],
          message,
          author,
        });
        if (mode === "direct") {
          if (!(await this.client.fastForward(this.branch, commit))) continue; // production moved
        } else {
          const reviewBranch = `${this.prefix}/review/${actorKey(options.actor)}-${Date.now().toString(36)}`;
          await this.client.createRef(reviewBranch, commit);
          const pull = await this.client.createPull({
            title: message.split("\n")[0] ?? message,
            head: reviewBranch,
            base: this.branch,
            body: reviewBody(options.actor, publishing),
          });
          review = {
            number: pull.number,
            url: pull.html_url,
            title: pull.title,
            createdAt: pull.created_at,
          };
        }
      }

      await this.settleDraft(options.actor, state, {
        submitted: mode === "review" ? publishing : [],
        adopt: tookTheirs,
        published: mode === "direct" ? publishing : [],
      });

      return {
        mode,
        commit: commit ? { sha: commit, url: this.client.webUrl(`/commit/${commit}`) } : null,
        published: publishing,
        tookTheirs,
        ...(review ? { review } : {}),
      };
    }
    throw busy(requested[0] ?? "");
  }

  private async discard(actor: StoreActor, paths: string[]): Promise<void> {
    const requested = [...new Set(paths.map(normalisePath))];
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const state = await this.state(actor);
      const dropping = requested.filter((path) => state.mine.has(path));
      if (dropping.length === 0 || state.draft === null) return;
      if (dropping.length === state.mine.size) {
        // Nothing left: clear the draft rather than delete it (see clearDraft).
        if (await this.clearDraft(actor, state.draft)) return;
        continue;
      }
      // Back to the base bytes, so the path stops differing from base. Not to
      // production's: that would be a silent merge of their change.
      const commit = await this.commitOnto(
        state.draft,
        state.draftFiles,
        dropping.map((path) => ({ path, sha: state.baseFiles.get(path) ?? null })),
        {
          parents: [state.draft],
          message: `Draft: discard ${dropping.join(", ")}`,
          author: authorOf(actor),
        },
      );
      if (await this.client.fastForward(this.draftBranch(actor), commit)) return;
    }
    throw busy(requested[0] ?? "");
  }

  private async reviews(actor: StoreActor): Promise<ReviewRequest[]> {
    const mine = `${this.prefix}/review/${actorKey(actor)}-`;
    const pulls = await this.client.listOpenPulls(this.branch);
    return pulls
      .filter((pull) => pull.head.ref.startsWith(mine))
      .map((pull) => ({
        number: pull.number,
        url: pull.html_url,
        title: pull.title,
        createdAt: pull.created_at,
      }));
  }

  /**
   * Tidy the draft after a publish. Best effort: correctness does not depend
   * on it, so a lost race here costs a stale branch, not a wrong answer.
   *
   * - Published directly: production now holds those bytes, so they drop out
   *   of `mine` with no rewrite.
   * - Submitted for review: the draft lets go of them (back to base bytes)
   *   until the pull request merges.
   * - Took theirs: the draft adopts production's bytes.
   */
  private async settleDraft(
    actor: StoreActor,
    before: DraftState,
    plan: { submitted: string[]; adopt: string[]; published: string[] },
  ): Promise<void> {
    const branch = this.draftBranch(actor);
    const draft = await this.client.getRef(branch);
    if (draft === null || draft !== before.draft) return;

    const settled = new Set([...plan.submitted, ...plan.adopt, ...plan.published]);
    if ([...before.mine.keys()].every((path) => settled.has(path))) {
      await this.clearDraft(actor, draft);
      return;
    }

    const entries: TreeChange[] = [
      ...plan.submitted.map((path) => ({ path, sha: before.baseFiles.get(path) ?? null })),
      ...plan.adopt.map((path) => ({ path, sha: before.mainFiles.get(path) ?? null })),
    ];
    if (entries.length === 0) return;
    const commit = await this.commitOnto(draft, before.draftFiles, entries, {
      parents: [draft],
      message: "Draft: settle after publish",
      author: authorOf(actor),
    });
    await this.client.fastForward(branch, commit);
  }

  /**
   * Empty a draft without deleting its branch. GitHub's REST API has no
   * conditional delete, so "check the head, then delete" loses a save that
   * lands in between. A fast-forward is conditional: the branch moves to a
   * commit holding production's tree, with the old head and production as
   * parents, only if nobody moved it first. The branch then has no changes,
   * and the editor's next save reuses it.
   */
  private async clearDraft(actor: StoreActor, head: string): Promise<boolean> {
    // Production as it is now: a publish has just moved it.
    const main = await this.requireMain();
    const commit = await this.commitOnto(main, await this.contentFiles(main), [], {
      parents: [head, main],
      message: "Draft: clear after publish or discard",
      author: authorOf(actor),
    });
    return this.client.fastForward(this.draftBranch(actor), commit);
  }

  /* ---- state ----------------------------------------------------------- */

  private draftBranch(actor: StoreActor): string {
    return `${this.prefix}/drafts/${actorKey(actor)}`;
  }

  /**
   * The production head. Lookups already in flight are shared, so reading
   * several published files at once (a listing with many pending deletions)
   * costs one ref request, not one each. Nothing is kept once it settles:
   * the next call sees a branch that moved.
   */
  private async requireMain(): Promise<string> {
    this.mainLookup ??= this.lookupMain().finally(() => {
      this.mainLookup = undefined;
    });
    return this.mainLookup;
  }

  private mainLookup: Promise<string> | undefined;

  private async lookupMain(): Promise<string> {
    const main = await this.client.getRef(this.branch);
    if (main === null) {
      throw new GraftError({
        code: "REMOTE_STORE_FAILED",
        message: `${this.client.repo} has no branch "${this.branch}".`,
        fix: "Set GRAFT_GITHUB_BRANCH to the branch your site deploys from.",
        details: { repo: this.client.repo, branch: this.branch },
      });
    }
    return main;
  }

  private async publishedState(): Promise<DraftState> {
    const main = await this.requireMain();
    const mainFiles = await this.contentFiles(main);
    return {
      main,
      draft: null,
      base: main,
      mainFiles,
      baseFiles: mainFiles,
      draftFiles: mainFiles,
      mine: new Map(),
      theirs: new Map(),
    };
  }

  private async state(actor: StoreActor): Promise<DraftState> {
    const [main, draft] = await Promise.all([
      this.requireMain(),
      this.client.getRef(this.draftBranch(actor)),
    ]);
    if (draft === null) return this.publishedState();

    const base = await this.mergeBase(main, draft);
    const [mainFiles, baseFiles, draftFiles] = await Promise.all([
      this.contentFiles(main),
      this.contentFiles(base),
      this.contentFiles(draft),
    ]);

    const theirs = diff(baseFiles, mainFiles);
    const mine = new Map<string, string | null>();
    for (const [path, sha] of diff(baseFiles, draftFiles)) {
      // Already what production holds: published, or merged from review.
      if ((mainFiles.get(path) ?? null) === sha) continue;
      mine.set(path, sha);
    }
    return { main, draft, base, mainFiles, baseFiles, draftFiles, mine, theirs };
  }

  private hasConflict(state: DraftState): boolean {
    for (const path of state.mine.keys()) if (isConflict(state, path)) return true;
    return false;
  }

  /* ---- git objects ----------------------------------------------------- */

  private async commit(sha: string): Promise<{ tree: string; parents: string[] }> {
    const known = this.commits.get(sha);
    if (known) return known;
    const commit = await this.client.getCommit(sha);
    const value = { tree: commit.tree.sha, parents: commit.parents.map((p) => p.sha) };
    this.commits.set(sha, value);
    return value;
  }

  private async mergeBase(main: string, draft: string): Promise<string> {
    const key = `${main}...${draft}`;
    const known = this.bases.get(key);
    if (known) return known;
    const base = await this.client.mergeBase(main, draft);
    this.bases.set(key, base);
    return base;
  }

  /** Every file under the content path at a commit. */
  private async contentFiles(commitSha: string): Promise<Files> {
    const known = this.files.get(commitSha);
    if (known) return known;

    let tree = (await this.commit(commitSha)).tree;
    const out = new Map<string, string>();
    let found = true;
    for (const segment of this.contentPath ? this.contentPath.split("/") : []) {
      const listing = await this.client.getTree(tree);
      const next = listing.tree.find((entry) => entry.path === segment && entry.type === "tree");
      if (!next) {
        found = false;
        break;
      }
      tree = next.sha;
    }
    if (found) {
      const listing = await this.client.getTree(tree, true);
      if (listing.truncated) {
        throw new GraftError({
          code: "REMOTE_STORE_FAILED",
          message: `The content directory in ${this.client.repo} is too large for GitHub to list in one response.`,
          fix: "Split content across collections in separate directories, or point GRAFT_GITHUB_CONTENT_PATH at the content directory itself rather than the repository root.",
          details: { contentPath: this.contentPath },
        });
      }
      for (const entry of listing.tree) {
        if (entry.type === "blob") out.set(entry.path, entry.sha);
      }
    }
    this.files.set(commitSha, out);
    return out;
  }

  private async blob(sha: string): Promise<string> {
    const known = this.blobs.get(sha);
    if (known !== undefined) return known;
    const raw = await this.client.getBlob(sha);
    if (this.blobs.size >= BLOB_CACHE_LIMIT) {
      const oldest = this.blobs.keys().next().value;
      if (oldest !== undefined) this.blobs.delete(oldest);
    }
    this.blobs.set(sha, raw);
    return raw;
  }

  /**
   * One commit: `parentFiles` plus `changes`, on top of `treeOf`'s tree.
   * Records the resulting file map, computed locally from blob SHAs, so the
   * next read of this commit costs nothing.
   */
  private async commitOnto(
    treeOf: string,
    parentFiles: Files,
    changes: (Entry | TreeChange)[],
    meta: { parents: string[]; message: string; author?: CommitAuthor },
  ): Promise<string> {
    const files = new Map(parentFiles);
    const entries: NewTreeEntry[] = [];
    for (const change of changes) {
      const path = change.path;
      const repoPath = this.contentPath ? `${this.contentPath}/${path}` : path;
      if ("raw" in change) {
        if (change.raw === null) {
          if (!files.has(path)) continue;
          files.delete(path);
          entries.push({ path: repoPath, mode: "100644", type: "blob", sha: null });
        } else {
          files.set(path, gitBlobSha(change.raw));
          entries.push({ path: repoPath, mode: "100644", type: "blob", content: change.raw });
        }
      } else if (change.sha === null) {
        if (!files.has(path)) continue;
        files.delete(path);
        entries.push({ path: repoPath, mode: "100644", type: "blob", sha: null });
      } else {
        files.set(path, change.sha);
        entries.push({ path: repoPath, mode: "100644", type: "blob", sha: change.sha });
      }
    }
    const baseTree = (await this.commit(treeOf)).tree;
    const tree = entries.length > 0 ? await this.client.createTree(baseTree, entries) : baseTree;
    const sha = await this.client.createCommit({
      message: meta.message,
      tree,
      parents: meta.parents,
      ...(meta.author ? { author: meta.author } : {}),
    });
    this.commits.set(sha, { tree, parents: meta.parents });
    this.files.set(sha, files);
    return sha;
  }
}

interface Entry {
  path: string;
  raw: string | null;
}

interface TreeChange {
  path: string;
  sha: string | null;
}

function entriesFor(mine: Map<string, string | null>): TreeChange[] {
  return [...mine].map(([path, sha]) => ({ path, sha }));
}

function isConflict(state: DraftState, path: string): boolean {
  if (!state.mine.has(path) || !state.theirs.has(path)) return false;
  return (state.theirs.get(path) ?? null) !== (state.mine.get(path) ?? null);
}

/** Paths whose blob differs between two file maps, with the `to` side's blob. */
function diff(from: Files, to: Files): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const [path, sha] of to) if (from.get(path) !== sha) out.set(path, sha);
  for (const path of from.keys()) if (!to.has(path)) out.set(path, null);
  return out;
}

/**
 * A content path from a request: relative, forward slashes, no `..`. The
 * store never touches a filesystem, but a path still names a place in
 * someone's repository, and `../.github/workflows/x.yml` is not content.
 */
export function normalisePath(path: string): string {
  const rel = path.replace(/\\/g, "/").replace(/^\/+/, "");
  const segments = rel.split("/");
  if (
    rel === "" ||
    rel.includes("\0") ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new GraftError({
      code: "INPUT_VALIDATION_FAILED",
      message: `"${path}" is not a content path.`,
      fix: 'Use a path inside the content directory, like "products/blue-shirt.mdx".',
      details: { path },
    });
  }
  return rel;
}

/**
 * A branch-safe key for an actor: lowercase, `[a-z0-9-]`, bounded, and one
 * key per id. An id that is already a clean key (`ana`, `writer-bot`) is used
 * as is. Any other id (`ana@shop.test`) keeps a readable prefix and gains a
 * hash of the whole id, so `a+b@x.com` and `a-b@x.com` never share a draft.
 *
 * The hash is joined with `--`, which a clean key cannot contain (runs of
 * other characters collapse to one `-`). Without that, a GitHub login such as
 * `ana-lima-shop-test-0123456789` could equal an invite email's hashed key,
 * and two people would share one draft branch.
 */
export function actorKey(actor: StoreActor): string {
  const readable = trimChar(actor.id.toLowerCase().replace(/[^a-z0-9]+/g, "-"), "-", "both");
  if (readable === actor.id && readable.length <= 48) return readable;
  const hash = createHash("sha256").update(actor.id).digest("hex").slice(0, 10);
  const prefix = trimChar(readable.slice(0, 36), "-");
  return prefix ? `${prefix}--${hash}` : `editor--${hash}`;
}

function authorOf(actor: StoreActor): CommitAuthor {
  return {
    name: actor.name?.trim() || actor.id,
    email: actor.email?.trim() || `${actorKey(actor)}@users.noreply.graft.dev`,
  };
}

function defaultMessage(paths: string[]): string {
  const names = paths.map((path) => path.replace(/\.mdx?$/, ""));
  if (names.length === 1) return `Publish ${names[0]}`;
  if (names.length <= 3) return `Publish ${names.join(", ")}`;
  return `Publish ${names.length} documents`;
}

function reviewBody(actor: StoreActor, paths: string[]): string {
  return [
    `Submitted for review from Graft Studio by ${actor.name ?? actor.id}.`,
    "",
    ...paths.map((path) => `- \`${path}\``),
  ].join("\n");
}

function busy(path: string): GraftError {
  return new GraftError({
    code: "CONTENT_CONFLICT",
    message: `"${path}" kept changing while this save was in flight.`,
    fix: "Another tab or editor is saving at the same moment. Retry; nothing was lost.",
    details: { path },
  });
}
