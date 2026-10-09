/**
 * The handful of GitHub REST calls the store needs, over `fetch`.
 *
 * No Octokit: the store uses eleven endpoints, and a dependency that size in
 * the package every Graft surface imports is not worth the convenience. The
 * base URL and `fetch` are injectable, which is how GitHub Enterprise Server
 * and the in-memory GitHub the tests run against both work.
 */
import { GraftError } from "@usegraft/contracts";
import type { GitHubAuth } from "./auth";

export interface GitHubClientOptions {
  /** "owner/name". */
  repo: string;
  auth: GitHubAuth;
  /** Defaults to https://api.github.com. */
  apiUrl?: string;
  fetch?: typeof fetch;
}

export interface GitTreeEntry {
  path: string;
  mode: string;
  type: "blob" | "tree" | "commit";
  sha: string;
}

export interface GitCommit {
  sha: string;
  tree: { sha: string };
  parents: { sha: string }[];
}

export interface NewTreeEntry {
  path: string;
  mode: "100644";
  type: "blob";
  /** A blob SHA, or null to delete the path. */
  sha?: string | null;
  /** Inline UTF-8 content; GitHub creates the blob. */
  content?: string;
}

export interface CommitAuthor {
  name: string;
  email: string;
}

export interface PullRequest {
  number: number;
  html_url: string;
  title: string;
  created_at: string;
  head: { ref: string };
}

/** A request that GitHub answered with an expected refusal, not a fault. */
export class GitHubStatus extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class GitHubClient {
  readonly repo: string;
  private readonly apiUrl: string;
  private readonly doFetch: typeof fetch;

  constructor(private readonly options: GitHubClientOptions) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(options.repo)) {
      throw new GraftError({
        code: "CONFIG_INVALID",
        message: `"${options.repo}" is not a GitHub repository name.`,
        fix: 'Set GRAFT_GITHUB_REPO to "owner/name", for example "acme/storefront".',
        details: { repo: options.repo },
      });
    }
    this.repo = options.repo;
    this.apiUrl = (options.apiUrl ?? "https://api.github.com").replace(/\/+$/, "");
    this.doFetch = options.fetch ?? fetch;
  }

  /** A web link to something in the repository. */
  webUrl(path: string): string {
    const host =
      this.apiUrl === "https://api.github.com"
        ? "https://github.com"
        : this.apiUrl.replace(/\/api\/v3$/, "");
    return `${host}/${this.repo}${path}`;
  }

  /**
   * One call. Statuses listed in `expect` come back as a GitHubStatus the
   * caller handles (a missing ref is a 404 the store expects to see); anything
   * else not OK is a REMOTE_STORE_FAILED carrying GitHub's own message.
   */
  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    expect: readonly number[] = [],
  ): Promise<T> {
    const token = await this.options.auth.token();
    const response = await this.doFetch(`${this.apiUrl}${path}`, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
        "user-agent": "graft-studio",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    const parsed = text ? (JSON.parse(text) as unknown) : undefined;
    if (response.ok) return parsed as T;

    const message =
      (parsed as { message?: string } | undefined)?.message ?? response.statusText ?? "";
    if (expect.includes(response.status)) throw new GitHubStatus(response.status, message);
    throw new GraftError({
      code: "REMOTE_STORE_FAILED",
      message: `GitHub refused ${method} ${path.split("?")[0]} (${response.status}): ${message}`,
      fix: hintFor(response.status, this.repo),
      details: { status: response.status, message, method, path: path.split("?")[0] },
    });
  }

  private repoPath(rest: string): string {
    return `/repos/${this.repo}${rest}`;
  }

  async getRef(branch: string): Promise<string | null> {
    try {
      const ref = await this.request<{ object: { sha: string } }>(
        "GET",
        this.repoPath(`/git/ref/heads/${encodeRef(branch)}`),
        undefined,
        [404],
      );
      return ref.object.sha;
    } catch (error) {
      if (error instanceof GitHubStatus) return null;
      throw error;
    }
  }

  /** Create a branch; false when it already exists. */
  async createRef(branch: string, sha: string): Promise<boolean> {
    try {
      await this.request(
        "POST",
        this.repoPath("/git/refs"),
        { ref: `refs/heads/${branch}`, sha },
        [422],
      );
      return true;
    } catch (error) {
      if (error instanceof GitHubStatus) return false;
      throw error;
    }
  }

  /**
   * Move a branch to a commit that has the current head as an ancestor.
   * Never forced, which makes it a compare-and-swap: false when the branch
   * moved since the caller read it.
   */
  async fastForward(branch: string, sha: string): Promise<boolean> {
    try {
      await this.request(
        "PATCH",
        this.repoPath(`/git/refs/heads/${encodeRef(branch)}`),
        { sha, force: false },
        [409, 422],
      );
      return true;
    } catch (error) {
      if (error instanceof GitHubStatus) return false;
      throw error;
    }
  }

  async deleteRef(branch: string): Promise<void> {
    try {
      await this.request(
        "DELETE",
        this.repoPath(`/git/refs/heads/${encodeRef(branch)}`),
        undefined,
        [404, 422],
      );
    } catch (error) {
      if (!(error instanceof GitHubStatus)) throw error;
    }
  }

  getCommit(sha: string): Promise<GitCommit> {
    return this.request("GET", this.repoPath(`/git/commits/${sha}`));
  }

  getTree(
    sha: string,
    recursive = false,
  ): Promise<{ sha: string; tree: GitTreeEntry[]; truncated: boolean }> {
    return this.request(
      "GET",
      this.repoPath(`/git/trees/${sha}${recursive ? "?recursive=1" : ""}`),
    );
  }

  async getBlob(sha: string): Promise<string> {
    const blob = await this.request<{ content: string; encoding: string }>(
      "GET",
      this.repoPath(`/git/blobs/${sha}`),
    );
    return blob.encoding === "base64"
      ? Buffer.from(blob.content, "base64").toString("utf8")
      : blob.content;
  }

  async createTree(baseTree: string, entries: NewTreeEntry[]): Promise<string> {
    const tree = await this.request<{ sha: string }>("POST", this.repoPath("/git/trees"), {
      base_tree: baseTree,
      tree: entries,
    });
    return tree.sha;
  }

  async createCommit(input: {
    message: string;
    tree: string;
    parents: string[];
    author?: CommitAuthor;
  }): Promise<string> {
    const commit = await this.request<{ sha: string }>("POST", this.repoPath("/git/commits"), {
      message: input.message,
      tree: input.tree,
      parents: input.parents,
      ...(input.author ? { author: { ...input.author, date: new Date().toISOString() } } : {}),
    });
    return commit.sha;
  }

  async mergeBase(base: string, head: string): Promise<string> {
    const compare = await this.request<{ merge_base_commit: { sha: string } }>(
      "GET",
      this.repoPath(`/compare/${base}...${head}?per_page=1`),
    );
    return compare.merge_base_commit.sha;
  }

  createPull(input: { title: string; head: string; base: string; body: string }) {
    return this.request<PullRequest>("POST", this.repoPath("/pulls"), input);
  }

  listOpenPulls(base: string) {
    return this.request<PullRequest[]>(
      "GET",
      this.repoPath(`/pulls?state=open&base=${encodeURIComponent(base)}&per_page=100`),
    );
  }

  /** "admin" | "maintain" | "write" | "triage" | "read" | "none". */
  async permissionOf(login: string): Promise<string> {
    try {
      const result = await this.request<{ permission: string; role_name?: string }>(
        "GET",
        this.repoPath(`/collaborators/${encodeURIComponent(login)}/permission`),
        undefined,
        [403, 404],
      );
      return result.role_name ?? result.permission;
    } catch (error) {
      if (error instanceof GitHubStatus) return "none";
      throw error;
    }
  }
}

/** Branch names keep their slashes in ref paths; each segment is encoded. */
function encodeRef(branch: string): string {
  return branch.split("/").map(encodeURIComponent).join("/");
}

function hintFor(status: number, repo: string): string {
  if (status === 401) {
    return "The GitHub credential was rejected. Check GRAFT_GITHUB_TOKEN, or the GitHub App id and private key.";
  }
  if (status === 403) {
    return `The credential cannot do this on ${repo}. A token needs Contents and Pull requests read/write; a GitHub App needs the same permissions and must be installed on the repository. A protected branch refuses direct pushes: set GRAFT_STUDIO_PUBLISH=pull-request.`;
  }
  if (status === 404) {
    return `GitHub reports ${repo} or the branch as missing. Check GRAFT_GITHUB_REPO and GRAFT_GITHUB_BRANCH, and that the credential can see a private repository.`;
  }
  if (status === 429) return "GitHub is rate limiting this credential. Wait a minute and retry.";
  return "Retry. If it persists, GitHub's status page and details.message say more.";
}
