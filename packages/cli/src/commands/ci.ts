/**
 * graft ci — keep CI cheap when a change is only content.
 *
 * - `changes` says whether a commit range touched nothing but the content
 *   directory, for a workflow to skip its heavy jobs on.
 * - `skip-build` exits 0 when a deploy can be skipped: the change is content
 *   only, and the project's content is in the database, so the site already
 *   serves it. Hosts' "ignore this build" commands read that exit code.
 * - `init` writes a small workflow that runs `graft check` on content changes.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { GraftError } from "@usegraft/contracts";
import { findConfig, loadConfig, type ProjectConfig } from "../config";

function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/** The base to compare against: --base, the pull request's base branch, else the previous commit. */
function baseRef(cwd: string, base: string | undefined): string {
  if (base) return base;
  const prBase = process.env.GITHUB_BASE_REF?.trim();
  if (prBase && git(cwd, ["rev-parse", "--verify", `origin/${prBase}`])) return `origin/${prBase}`;
  return "HEAD~1";
}

export interface ChangesResult {
  base: string;
  files: string[];
  /** True when every changed file is under the content directory. */
  contentOnly: boolean;
  /** The content directory, relative to the repository root. */
  contentPath: string;
}

export async function ciChanges(options: { cwd: string; base?: string }): Promise<ChangesResult> {
  const config = await loadConfig(findConfig(options.cwd));
  return changesFor(config, options.cwd, options.base);
}

function changesFor(config: ProjectConfig, cwd: string, base: string | undefined): ChangesResult {
  const root = git(cwd, ["rev-parse", "--show-toplevel"]);
  const ref = baseRef(cwd, base);
  if (!root) {
    throw new GraftError({
      code: "GIT_UNAVAILABLE",
      message: "This is not inside a git repository, so there are no changes to compare.",
      fix: "Run it in the repository's checkout. In CI, check the repository out first.",
    });
  }
  const contentPath = relative(root, config.contentDir).split(sep).join("/");
  const diff =
    git(cwd, ["diff", "--name-only", `${ref}...HEAD`]) ??
    git(cwd, ["diff", "--name-only", ref, "HEAD"]);
  // No comparison possible (a shallow clone, a first commit): assume the
  // change is not content-only, so nothing that should run is skipped.
  const files = diff === null ? [] : diff.split("\n").filter(Boolean);
  const contentOnly =
    diff !== null && files.length > 0 && files.every((file) => file.startsWith(`${contentPath}/`));
  return { base: ref, files, contentOnly, contentPath };
}

/** Print the result, and hand it to a GitHub Actions step through $GITHUB_OUTPUT. */
export function reportChanges(result: ChangesResult): string[] {
  const output = process.env.GITHUB_OUTPUT;
  if (output) appendFileSync(output, `content-only=${result.contentOnly}\n`);
  return [
    `content-only=${result.contentOnly}`,
    `files=${result.files.length}`,
    `base=${result.base}`,
  ];
}

export async function ciSkipBuild(options: {
  cwd: string;
  base?: string;
}): Promise<{ skip: boolean; reason: string }> {
  const config = await loadConfig(findConfig(options.cwd));
  const changes = changesFor(config, options.cwd, options.base);
  if (config.content.source !== "database") {
    return {
      skip: false,
      reason: "Build: content is in git, so the site is built from it.",
    };
  }
  if (!changes.contentOnly) {
    return {
      skip: false,
      reason: `Build: ${changes.files.length} changed file(s), not only content.`,
    };
  }
  return {
    skip: true,
    reason: `Skip: only ${changes.contentPath}/ changed, and the site already serves that content from the database.`,
  };
}

function workflow(config: ProjectConfig, root: string): string {
  const projectPath = relative(root, config.projectDir).split(sep).join("/") || ".";
  const contentPath = relative(root, config.contentDir).split(sep).join("/");
  const pnpm =
    existsSync(join(config.projectDir, "pnpm-lock.yaml")) ||
    existsSync(join(root, "pnpm-lock.yaml"));
  const install = pnpm
    ? ["      - uses: pnpm/action-setup@v4", "      - run: pnpm install --frozen-lockfile"]
    : ["      - run: npm ci"];
  const run = pnpm ? "pnpm exec graft check" : "npx graft check";
  return [
    "# Checks content changes in seconds: the schema, slugs, MDX safety and",
    "# references. Written by `graft ci init`.",
    "#",
    "# To keep heavier workflows off content-only changes without leaving a",
    "# required check waiting forever, decide inside the workflow instead of",
    "# with a path filter:",
    "#",
    "#   - id: graft",
    "#     run: npx graft ci changes",
    "#   - if: steps.graft.outputs.content-only != 'true'",
    "#     run: npm test",
    "name: Content",
    "",
    "on:",
    "  pull_request:",
    `    paths: ["${contentPath}/**"]`,
    "  push:",
    `    paths: ["${contentPath}/**"]`,
    "",
    "jobs:",
    "  check:",
    "    runs-on: ubuntu-latest",
    "    defaults:",
    "      run:",
    `        working-directory: ${projectPath}`,
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - uses: actions/setup-node@v4",
    "        with:",
    "          node-version: 22",
    ...install,
    `      - run: ${run}`,
    "",
  ].join("\n");
}

export async function ciInit(options: { cwd: string; overwrite?: boolean }): Promise<string[]> {
  const config = await loadConfig(findConfig(options.cwd));
  const root = git(options.cwd, ["rev-parse", "--show-toplevel"]) ?? config.projectDir;
  const file = join(root, ".github", "workflows", "graft-content.yml");
  if (existsSync(file) && !options.overwrite) {
    throw new GraftError({
      code: "ALREADY_INITIALIZED",
      message: `${relative(options.cwd, file)} already exists.`,
      fix: "Pass --overwrite to replace it, or edit it by hand.",
      details: { file },
    });
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, workflow(config, root));
  return [
    `Wrote ${relative(options.cwd, file) || file}.`,
    "It runs graft check when content changes. The comment at its top shows how to keep heavier workflows off content-only changes.",
  ];
}
