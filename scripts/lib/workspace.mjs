/**
 * Which packages this repo publishes, and which channel it publishes them to.
 *
 * Four scripts need this and three had grown their own byte-identical copy of
 * the pnpm-workspace parser: assert-canary-snapshot, assert-canary-published,
 * check-dist-tags. That is the shape of drift this repo already writes checks
 * against elsewhere — the copies agree until one is fixed and the others are
 * not, and the ones left behind keep guarding the release with an answer that
 * has quietly stopped being true.
 *
 * Members come from pnpm-workspace.yaml rather than a hardcoded `packages/`,
 * because a publishable package does not have to live there and a guard that
 * silently skips one is worse than no guard.
 */
import { execFileSync } from "node:child_process";
import { existsSync, globSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * The `packages:` globs from pnpm-workspace.yaml.
 *
 * Parsed here rather than shelled out to `pnpm list`: locating pnpm across
 * platforms needs `shell: true`, and Node deprecated passing args alongside it
 * (DEP0190). The block is a plain list, so reading it is smaller than the
 * subprocess it replaces.
 */
export function workspaceGlobs() {
  const lines = readFileSync("pnpm-workspace.yaml", "utf8").split(/\r?\n/);
  const start = lines.findIndex((line) => /^packages:\s*$/.test(line));
  const globs = [];
  for (let i = start + 1; start !== -1 && i < lines.length; i++) {
    if (/^\S/.test(lines[i])) break; // the next top-level key ends the block
    const item = lines[i].match(/^\s*-\s*["']?([^"'\s#]+)["']?\s*$/);
    if (item) globs.push(item[1]);
  }
  if (globs.length === 0) {
    throw new Error("Parsed no workspace globs from pnpm-workspace.yaml. Refusing to guess.");
  }
  return globs;
}

/**
 * Every workspace member, private ones included, as `{name, version, private}`.
 *
 * A manifest that cannot be read or parsed throws rather than being skipped.
 * The version this replaced carried `catch { /* cannot be published either *​/ }`,
 * which is false: an unreadable manifest means the member's publishability is
 * unknown, not that it is absent. Dropping it silently shrinks the set every
 * caller then reasons over, so `assert-canary-published` verified the survivors
 * and reported a complete release — "1 of 1 published" with the malformed
 * member simply gone.
 *
 * Note this is the behaviour assert-canary-published always had, before three
 * copies of this parser were collapsed into one: its version let JSON.parse
 * throw. Unifying on the tolerant copy quietly took that away. Release guards
 * fail closed.
 */
export function workspaceProjects() {
  const seen = new Set();
  const projects = [];
  const unreadable = [];
  for (const glob of workspaceGlobs()) {
    for (const manifestPath of globSync(join(glob, "package.json"))) {
      const dir = dirname(manifestPath);
      if (seen.has(dir)) continue;
      seen.add(dir);
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
        projects.push({
          name: manifest.name,
          version: manifest.version,
          private: manifest.private === true,
        });
      } catch (error) {
        unreadable.push(`  ${manifestPath.replaceAll("\\", "/")} — ${error.message}`);
      }
    }
  }
  if (unreadable.length > 0) {
    throw new Error(
      `${unreadable.length} workspace manifest(s) could not be read:\n${unreadable.join("\n")}\n\n` +
        "Refusing to answer questions about the workspace from a partial reading of it.",
    );
  }
  return projects;
}

/** The members npm would actually receive. */
export function publishablePackages() {
  return workspaceProjects()
    .filter((p) => !p.private && p.name && p.version)
    .map(({ name, version }) => ({ name, version }));
}

/**
 * The one version this release carries.
 *
 * `.changeset/config.json` sets `fixed: [["@usegraft/*"]]`, so every publishable
 * package moves together and one version describes the release. Disagreement
 * means a partial `changeset version` run, which is worth stopping on before
 * anything is judged against it.
 */
export function releaseVersion(packages) {
  const versions = [...new Set(packages.map((p) => p.version))];
  if (versions.length > 1) {
    throw new Error(
      `Workspace packages disagree about the version: ${versions.join(", ")}.\n` +
        "`fixed` should keep these identical. Refusing to act on a guess.",
    );
  }
  return versions[0];
}

/**
 * Where `latest` belongs, and why.
 *
 * In pre mode the answer is the prerelease, not the newest stable. The 0.x line
 * is deprecated and the beta is what the documentation describes, so a bare
 * install has to reach it — that is the whole reason `@beta` was removed from
 * every install command. Reading `mode` matters: `changeset pre exit` leaves
 * pre.json in place with `mode: "exit"`, which means stable, and treating that
 * as beta would pin `latest` to a prerelease after graduating away from one.
 */
export function releaseChannel() {
  let pre;
  try {
    pre = JSON.parse(readFileSync(".changeset/pre.json", "utf8"));
  } catch {
    return { name: "stable", tags: ["latest"] };
  }
  if (pre.mode === "exit" || pre.mode === "none") return { name: "stable", tags: ["latest"] };
  return { name: pre.tag, tags: ["latest", pre.tag] };
}

/**
 * The grammar npm accepts for a package name.
 *
 * Defence in depth rather than the barrier it used to be — see `npm()` below,
 * which no longer builds a shell command for anything to be injected into. Kept
 * because a name that fails this could not have been published anyway, so
 * refusing it early costs nothing and keeps a nonsense manifest from reaching
 * the registry as a confusing npm error.
 */
export const NPM_NAME = /^(?:@[a-z0-9-][a-z0-9._-]*\/)?[a-z0-9-][a-z0-9._-]*$/;

export const REGISTRY = "https://registry.npmjs.org";

/**
 * A package's dist-tags, read over HTTP, as one of three distinct answers.
 *
 * Reading is a plain GET, so it does not go near npm or a subprocess at all —
 * which is both faster and one fewer place for repo metadata to reach a shell.
 * assert-canary-published already queries the registry this way; spawning
 * `npm view` 21 times took over four minutes and was timing out, because each
 * call pays npm's whole startup.
 *
 * The three answers matter as much as the speed. A 404 is a package that is not
 * published, which is a real answer. Anything else — a 500, a proxy, DNS, a
 * body that will not parse — is a failure to look, and a failure to look must
 * never be returned as "nothing wrong here", because callers skip the absent
 * ones and would report a clean result over packages they never read.
 */
export async function fetchDistTags(name) {
  if (!NPM_NAME.test(name)) {
    return { kind: "failed", reason: `not a package name npm would accept: ${name}` };
  }
  let response;
  try {
    // The name goes in unencoded, which is safe only because NPM_NAME ran
    // first: everything it permits — letters, digits, `-` `.` `_` `~`, one
    // leading `@` and one `/` — is already legal in a URL path, so there is
    // nothing to escape. The previous `encodeURIComponent(name).replace("%40",
    // "@")` encoded the whole thing and then undid one character of it, which
    // CodeQL flagged as incomplete sanitisation and was right to: a replace of
    // a single occurrence standing in for a decode is a pattern that is correct
    // only by accident of the input. assert-canary-published builds its URL
    // this way too.
    response = await fetch(`${REGISTRY}/${name}`, {
      headers: { accept: "application/json" },
    });
  } catch (error) {
    return { kind: "failed", reason: error.message };
  }
  if (response.status === 404) return { kind: "absent" };
  if (!response.ok) return { kind: "failed", reason: `registry answered ${response.status}` };

  let body;
  try {
    body = await response.json();
  } catch {
    return { kind: "failed", reason: "registry answered 200 with a body that did not parse" };
  }
  const tags = body["dist-tags"];
  if (tags === null || typeof tags !== "object" || Array.isArray(tags)) {
    return { kind: "failed", reason: "registry answered without a dist-tags object" };
  }
  return { kind: "tags", tags };
}

/**
 * Run npm with arguments passed as arguments, never as a command string.
 *
 * The earlier version built `npm view ${name} …` and handed it to a shell,
 * because `execFileSync("npm", …)` cannot spawn npm on Windows (it is a `.cmd`
 * shim) and naming `npm.cmd` does not survive Git Bash's POSIX-shaped PATH. A
 * regex on the package name stood in for escaping.
 *
 * That was the wrong trade, and it was worse than intended: the read path
 * interpolated the name *before* the regex ran, and neither the version nor the
 * dist-tag was checked at all. Three values out of a repo's own metadata reached
 * a shell — which matters here precisely because a pull request can add a
 * workspace member, and a maintainer runs these scripts locally with publish
 * rights.
 *
 * The shell is gone instead of better-guarded. npm ships as a plain JS entry
 * point next to the node binary running this, so it can be invoked as an
 * argument to node itself: no shim, no PATH lookup, no quoting, nothing to
 * escape. Where that layout does not hold (nvm, volta, some corepack setups)
 * the PATH candidates are tried with `shell: false` — and if none spawn, this
 * throws rather than falling back to a shell. There is no path through here
 * that reaches one.
 */
export function npm(args, options = {}) {
  const bundled = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  const candidates = existsSync(bundled)
    ? [[process.execPath, [bundled, ...args]]]
    : [
        ["npm.cmd", args],
        ["npm", args],
      ];

  let lastError;
  for (const [command, argv] of candidates) {
    try {
      return execFileSync(command, argv, { shell: false, ...options });
    } catch (error) {
      // ENOENT means this candidate is not npm; anything else is npm answering,
      // and the caller wants that error rather than the next guess.
      if (error.code !== "ENOENT") throw error;
      lastError = error;
    }
  }
  throw new Error(
    `Could not locate npm to run \`npm ${args.join(" ")}\`` +
      `${lastError ? ` (${lastError.message})` : ""}.`,
  );
}
