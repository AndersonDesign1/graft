/**
 * An in-memory GitHub: the REST endpoints the GitHub store uses, over a real
 * git object model (content-addressed blobs, nested trees, commits with
 * parents, fast-forward-only ref updates).
 *
 * It exists so the store's behaviour (drafts, publishing, conflicts, races)
 * is tested against the protocol rather than against mocks of the store's own
 * calls, and so an end-to-end run of a hosted Studio can point at something
 * that behaves like GitHub without credentials. Blob SHAs are real git SHAs;
 * tree and commit SHAs are deterministic but not git's, which nothing in the
 * store depends on.
 *
 * Exported from `@usegraft/compiler/testing`.
 */
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { gitBlobSha } from "../blob";

interface TreeEntry {
  path: string;
  mode: string;
  type: "blob" | "tree";
  sha: string;
}

interface Commit {
  tree: string;
  parents: string[];
  message: string;
  author: { name: string; email: string };
}

interface Pull {
  number: number;
  title: string;
  body: string;
  head: string;
  base: string;
  state: "open" | "closed";
  merged: boolean;
  createdAt: string;
}

export interface GitHubFakeOptions {
  /** "owner/name". Default "acme/site". */
  repo?: string;
  /** Default "main". */
  branch?: string;
  /** Initial files on the branch, by repository path. */
  files?: Record<string, string>;
  /** Required bearer token. Default "test-token". */
  token?: string;
  /** login -> permission, for the collaborator permission endpoint. */
  permissions?: Record<string, string>;
  /** Base URL the fake answers on. Default "https://github.test/api". */
  apiUrl?: string;
}

export interface GitHubFake {
  readonly apiUrl: string;
  readonly repo: string;
  readonly token: string;
  fetch: typeof fetch;
  /** Every request served, in order. */
  readonly requests: { method: string; path: string }[];
  /** Files at a branch head, by repository path. */
  files(branch?: string): Record<string, string>;
  branches(): string[];
  head(branch?: string): string | undefined;
  log(branch?: string): (Commit & { sha: string })[];
  pulls(): Pull[];
  /** Commit straight to a branch, as a developer's push would. */
  push(
    branch: string,
    changes: Record<string, string | null>,
    message?: string,
    author?: { name: string; email: string },
  ): string;
  /** Merge an open pull request by squashing it onto its base. */
  mergePull(number: number): string;
  /** Answer the next N calls to a path prefix with a status, to test failures. */
  failNext(method: string, pathPrefix: string, status: number, times?: number): void;
  /** Serve over real HTTP, for an end-to-end run. */
  listen(port?: number): Promise<{ url: string; close: () => Promise<void> }>;
}

const sha1 = (input: string): string => createHash("sha1").update(input).digest("hex");

export function createGitHubFake(options: GitHubFakeOptions = {}): GitHubFake {
  const repo = options.repo ?? "acme/site";
  const token = options.token ?? "test-token";
  const defaultBranch = options.branch ?? "main";
  let apiUrl = (options.apiUrl ?? "https://github.test/api").replace(/\/+$/, "");
  const permissions = options.permissions ?? {};

  const blobs = new Map<string, string>();
  const trees = new Map<string, TreeEntry[]>();
  const commits = new Map<string, Commit>();
  const refs = new Map<string, string>();
  const pulls: Pull[] = [];
  const requests: { method: string; path: string }[] = [];
  const failures: { method: string; prefix: string; status: number; times: number }[] = [];
  let clock = Date.parse("2026-10-01T00:00:00Z");

  function putBlob(content: string): string {
    const sha = gitBlobSha(content);
    blobs.set(sha, content);
    return sha;
  }

  /** Nested trees from a flat path -> blob map. Returns the root tree SHA. */
  function buildTree(flat: Map<string, string>): string {
    const direct: TreeEntry[] = [];
    const children = new Map<string, Map<string, string>>();
    for (const [path, sha] of flat) {
      const slash = path.indexOf("/");
      if (slash === -1) {
        direct.push({ path, mode: "100644", type: "blob", sha });
      } else {
        const dir = path.slice(0, slash);
        const sub = children.get(dir) ?? new Map<string, string>();
        sub.set(path.slice(slash + 1), sha);
        children.set(dir, sub);
      }
    }
    for (const [dir, sub] of children) {
      direct.push({ path: dir, mode: "040000", type: "tree", sha: buildTree(sub) });
    }
    direct.sort((a, b) => a.path.localeCompare(b.path));
    const sha = sha1(`tree:${JSON.stringify(direct)}`);
    trees.set(sha, direct);
    return sha;
  }

  function flatten(treeSha: string, prefix = "", withTrees = false): TreeEntry[] {
    const out: TreeEntry[] = [];
    for (const entry of trees.get(treeSha) ?? []) {
      const path = prefix ? `${prefix}/${entry.path}` : entry.path;
      if (entry.type === "tree") {
        if (withTrees) out.push({ ...entry, path });
        out.push(...flatten(entry.sha, path, withTrees));
      } else {
        out.push({ ...entry, path });
      }
    }
    return out;
  }

  const flatMap = (treeSha: string): Map<string, string> =>
    new Map(flatten(treeSha).map((entry) => [entry.path, entry.sha]));

  function makeCommit(input: Commit): string {
    clock += 1000;
    const sha = sha1(`commit:${JSON.stringify(input)}:${clock}:${commits.size}`);
    commits.set(sha, input);
    return sha;
  }

  function ancestors(sha: string): string[] {
    const seen: string[] = [];
    const queue = [sha];
    const visited = new Set<string>();
    while (queue.length > 0) {
      const next = queue.shift() as string;
      if (visited.has(next)) continue;
      visited.add(next);
      seen.push(next);
      queue.push(...(commits.get(next)?.parents ?? []));
    }
    return seen;
  }

  function mergeBase(a: string, b: string): string | undefined {
    const ofA = new Set(ancestors(a));
    return ancestors(b).find((sha) => ofA.has(sha));
  }

  // Seed.
  {
    const flat = new Map<string, string>();
    for (const [path, content] of Object.entries(options.files ?? {})) {
      flat.set(path, putBlob(content));
    }
    const root = makeCommit({
      tree: buildTree(flat),
      parents: [],
      message: "Initial commit",
      author: { name: "Seed", email: "seed@example.com" },
    });
    refs.set(defaultBranch, root);
  }

  const json = (status: number, body?: unknown): Response =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  const notFound = (): Response => json(404, { message: "Not Found" });

  function applyToBranch(
    branch: string,
    changes: Record<string, string | null>,
    message: string,
    author = { name: "Dev", email: "dev@example.com" },
  ): string {
    const head = refs.get(branch);
    if (!head) throw new Error(`no branch ${branch}`);
    const flat = flatMap((commits.get(head) as Commit).tree);
    for (const [path, content] of Object.entries(changes)) {
      if (content === null) flat.delete(path);
      else flat.set(path, putBlob(content));
    }
    const sha = makeCommit({ tree: buildTree(flat), parents: [head], message, author });
    refs.set(branch, sha);
    return sha;
  }

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.slice(new URL(apiUrl).pathname.replace(/\/$/, "").length);
    const method = request.method;
    requests.push({ method, path: path + url.search });

    const failure = failures.find((f) => f.method === method && path.startsWith(f.prefix));
    if (failure) {
      failure.times -= 1;
      if (failure.times <= 0) failures.splice(failures.indexOf(failure), 1);
      return json(failure.status, { message: `Injected ${failure.status}` });
    }

    if (request.headers.get("authorization") !== `Bearer ${token}`) {
      return json(401, { message: "Bad credentials" });
    }
    const body = (
      method === "GET" || method === "DELETE"
        ? undefined
        : ((await request.json()) as Record<string, unknown>)
    ) as Record<string, never>;

    const prefix = `/repos/${repo}`;
    if (!path.startsWith(prefix)) return notFound();
    const rest = path.slice(prefix.length);

    let match: RegExpExecArray | null;
    if (method === "GET" && (match = /^\/git\/ref\/heads\/(.+)$/.exec(rest))) {
      const branch = decodeURIComponent(match[1] as string);
      const sha = refs.get(branch);
      return sha ? json(200, { ref: `refs/heads/${branch}`, object: { sha } }) : notFound();
    }
    if (method === "POST" && rest === "/git/refs") {
      const ref = String(body.ref).replace(/^refs\/heads\//, "");
      if (refs.has(ref)) return json(422, { message: "Reference already exists" });
      if (!commits.has(body.sha)) return json(422, { message: "Object does not exist" });
      refs.set(ref, body.sha);
      return json(201, { ref: `refs/heads/${ref}`, object: { sha: body.sha } });
    }
    if ((match = /^\/git\/refs\/heads\/(.+)$/.exec(rest))) {
      const branch = decodeURIComponent(match[1] as string);
      const current = refs.get(branch);
      if (!current) return json(422, { message: "Reference does not exist" });
      if (method === "DELETE") {
        refs.delete(branch);
        return new Response(null, { status: 204 });
      }
      if (method === "PATCH") {
        const next = String(body.sha);
        if (!commits.has(next)) return json(422, { message: "Object does not exist" });
        if (!body.force && !ancestors(next).includes(current)) {
          return json(422, { message: "Update is not a fast forward" });
        }
        refs.set(branch, next);
        return json(200, { ref: `refs/heads/${branch}`, object: { sha: next } });
      }
    }
    if (method === "GET" && (match = /^\/git\/commits\/([0-9a-f]+)$/.exec(rest))) {
      const commit = commits.get(match[1] as string);
      if (!commit) return notFound();
      return json(200, {
        sha: match[1],
        tree: { sha: commit.tree },
        parents: commit.parents.map((sha) => ({ sha })),
        message: commit.message,
        author: commit.author,
      });
    }
    if (method === "GET" && (match = /^\/git\/trees\/([0-9a-f]+)$/.exec(rest))) {
      const sha = match[1] as string;
      if (!trees.has(sha)) return notFound();
      const recursive = url.searchParams.get("recursive") === "1";
      return json(200, {
        sha,
        tree: recursive ? flatten(sha, "", true) : trees.get(sha),
        truncated: false,
      });
    }
    if (method === "GET" && (match = /^\/git\/blobs\/([0-9a-f]+)$/.exec(rest))) {
      const content = blobs.get(match[1] as string);
      if (content === undefined) return notFound();
      return json(200, {
        sha: match[1],
        encoding: "base64",
        content: Buffer.from(content, "utf8").toString("base64"),
      });
    }
    if (method === "POST" && rest === "/git/trees") {
      const base = body.base_tree ? flatMap(String(body.base_tree)) : new Map<string, string>();
      for (const entry of body.tree as {
        path: string;
        sha?: string | null;
        content?: string;
      }[]) {
        if (typeof entry.content === "string") base.set(entry.path, putBlob(entry.content));
        else if (entry.sha === null) {
          if (!base.has(entry.path)) return json(422, { message: `${entry.path} not in tree` });
          base.delete(entry.path);
        } else if (entry.sha) {
          if (!blobs.has(entry.sha)) return json(422, { message: "Blob does not exist" });
          base.set(entry.path, entry.sha);
        }
      }
      return json(201, { sha: buildTree(base) });
    }
    if (method === "POST" && rest === "/git/commits") {
      const parents = body.parents as string[];
      if (parents.some((sha) => !commits.has(sha))) {
        return json(422, { message: "Parent does not exist" });
      }
      const author = (body.author as { name: string; email: string } | undefined) ?? {
        name: "App",
        email: "app@example.com",
      };
      const sha = makeCommit({
        tree: String(body.tree),
        parents,
        message: String(body.message),
        author: { name: author.name, email: author.email },
      });
      return json(201, { sha });
    }
    if (method === "GET" && (match = /^\/compare\/([0-9a-f]+)\.\.\.([0-9a-f]+)$/.exec(rest))) {
      const base = mergeBase(match[1] as string, match[2] as string);
      if (!base) return notFound();
      return json(200, { merge_base_commit: { sha: base } });
    }
    if (rest === "/pulls" && method === "POST") {
      const pull: Pull = {
        number: pulls.length + 1,
        title: String(body.title),
        body: String(body.body ?? ""),
        head: String(body.head),
        base: String(body.base),
        state: "open",
        merged: false,
        createdAt: new Date(clock).toISOString(),
      };
      pulls.push(pull);
      return json(201, toPullJson(pull));
    }
    if (rest === "/pulls" && method === "GET") {
      const base = url.searchParams.get("base");
      return json(
        200,
        pulls
          .filter((pull) => pull.state === "open" && (!base || pull.base === base))
          .map(toPullJson),
      );
    }
    if (method === "GET" && (match = /^\/collaborators\/([^/]+)\/permission$/.exec(rest))) {
      const login = decodeURIComponent(match[1] as string);
      const permission = permissions[login];
      return permission ? json(200, { permission, role_name: permission }) : notFound();
    }
    return notFound();
  }

  function toPullJson(pull: Pull) {
    return {
      number: pull.number,
      title: pull.title,
      body: pull.body,
      state: pull.state,
      merged: pull.merged,
      html_url: `https://github.test/${repo}/pull/${pull.number}`,
      created_at: pull.createdAt,
      head: { ref: pull.head },
      base: { ref: pull.base },
    };
  }

  const fake: GitHubFake = {
    get apiUrl() {
      return apiUrl;
    },
    repo,
    token,
    requests,
    fetch: (async (input: string | URL | Request, init?: RequestInit) =>
      handle(new Request(input, init))) as typeof fetch,
    files(branch = defaultBranch) {
      const head = refs.get(branch);
      if (!head) return {};
      return Object.fromEntries(
        [...flatMap((commits.get(head) as Commit).tree)].map(([path, sha]) => [
          path,
          blobs.get(sha) as string,
        ]),
      );
    },
    branches: () => [...refs.keys()].sort(),
    head: (branch = defaultBranch) => refs.get(branch),
    log(branch = defaultBranch) {
      const out: (Commit & { sha: string })[] = [];
      let sha = refs.get(branch);
      while (sha) {
        const commit = commits.get(sha) as Commit;
        out.push({ ...commit, sha });
        sha = commit.parents[0];
      }
      return out;
    },
    pulls: () => pulls.map((pull) => ({ ...pull })),
    push: (branch, changes, message = "Developer push", author) =>
      applyToBranch(branch, changes, message, author),
    mergePull(number) {
      const pull = pulls.find((candidate) => candidate.number === number);
      if (!pull || pull.state !== "open") throw new Error(`pull ${number} is not open`);
      const head = refs.get(pull.head) as string;
      const baseHead = refs.get(pull.base) as string;
      const ancestor = mergeBase(baseHead, head) as string;
      const from = flatMap((commits.get(ancestor) as Commit).tree);
      const to = flatMap((commits.get(head) as Commit).tree);
      const changes: Record<string, string | null> = {};
      for (const [path, sha] of to)
        if (from.get(path) !== sha) changes[path] = blobs.get(sha) ?? "";
      for (const path of from.keys()) if (!to.has(path)) changes[path] = null;
      const sha = applyToBranch(pull.base, changes, `${pull.title} (#${pull.number})`);
      pull.state = "closed";
      pull.merged = true;
      return sha;
    },
    failNext(method, pathPrefix, status, times = 1) {
      failures.push({ method, prefix: pathPrefix, status, times });
    },
    async listen(port = 0) {
      const server = createServer(async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const response = await handle(
          new Request(`${apiUrl}${(req.url ?? "/").replace(/^\/api/, "")}`, {
            method: req.method,
            headers: req.headers as Record<string, string>,
            ...(chunks.length > 0 ? { body: Buffer.concat(chunks) } : {}),
          }),
        );
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
      });
      await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
      const address = server.address();
      const bound = typeof address === "object" && address ? address.port : port;
      apiUrl = `http://127.0.0.1:${bound}/api`;
      return {
        url: apiUrl,
        close: () => new Promise<void>((resolve) => server.close(() => resolve())),
      };
    },
  };
  return fake;
}
