/**
 * Documented install commands carry no dist-tag. This keeps them that way.
 *
 * The rule used to be the opposite. `latest` pointed at 0.2.0 while every page
 * described `1.0.0-beta.x`, so a reader copying `npm i @usegraft/cli` landed on
 * a build that did not match the page — during that beta, `approvalPolicy` in
 * config silently doing nothing, because 0.2.0 still read an environment
 * variable. The fix at the time was to write `@beta` into all 22 files and
 * derive the tag from `.changeset/pre.json`.
 *
 * That was treating the symptom. The real defect was the dist-tag: `latest`
 * is what a bare install resolves, and it pointed somewhere we did not want
 * anyone. On 2026-09-02 `latest` was moved to the prerelease across all 21
 * published packages, and the 0.x line deprecated. A bare install now lands on
 * the version the docs describe, which is what `latest` is for.
 *
 * So the tag comes off, and the invariant this script enforces is the simple
 * one: **an install command in this repo names a package and nothing else.**
 * A tag reappearing means someone is documenting a channel again, and the two
 * halves — what `latest` resolves and what the docs say — have to agree.
 *
 * ⚠️ The half this script cannot see is the registry. It enforces that the docs
 * carry no tag; it cannot check that `latest` still points where we think.
 * Publishing a prerelease while `latest` sits on something older reopens the
 * original bug, and nothing here will catch it. That is a release-process
 * property, kept by moving the tag, not a property of this file.
 *
 *   node scripts/install-tag.mjs           strip any tag from install commands
 *   node scripts/install-tag.mjs --check   exit 1 if anything carries one
 *
 * CHANGELOGs are deliberately untouched. They narrate what happened at a
 * version — "`npm i @usegraft/sdk-react` installed postgres and drizzle-orm" is
 * a statement about the past, and rewriting it would falsify the record.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const check = process.argv.includes("--check");

/** Build output and dependencies never hold a hand-written install command. */
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".astro",
  ".vercel",
  ".turbo",
  ".graft",
  ".next",
]);

/** Every file under `dir` whose extension is in `exts`, recursively. */
function walk(dir, exts, found = []) {
  if (!existsSync(dir)) return found;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name), exts, found);
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      found.push(join(dir, entry.name));
    }
  }
  return found;
}

/**
 * Files that tell a reader how to install. Not CHANGELOGs — see the note above.
 *
 * The landing was missing for a while, and the failure was the one this script
 * exists to prevent: the docs said `@usegraft/cli@beta` while the front page —
 * the first install command anyone sees — said `@usegraft/cli`, sending readers
 * to 0.2.0. Prose is not the only place a command lives, so the source of the
 * site that renders it is scanned too, and by directory rather than by a list
 * of filenames, so a new component carrying a command is covered by existing.
 *
 * This script itself is deliberately not a target. It quotes install commands
 * in its own header to explain what it does, and rewriting those would turn an
 * explanation into a claim about the current channel.
 */
function targets() {
  const files = [];
  const readme = join(root, "README.md");
  if (existsSync(readme)) files.push(readme);

  for (const group of ["packages", "examples"]) {
    const dir = join(root, group);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = join(dir, entry.name, "README.md");
      if (existsSync(candidate)) files.push(candidate);
    }
  }

  const site = join(root, "examples", "docs-site");
  files.push(...walk(join(site, "content"), [".mdx", ".md"]));
  files.push(...walk(join(site, "src"), [".ts", ".tsx", ".astro"]));

  return files;
}

/**
 * The runners a command can start with. Shared by the strict matcher and the
 * unparsed-command detector below, so the two can never disagree about what
 * counts as an install command.
 */
const RUNNERS = ["npm i", "npm install", "pnpm add", "pnpm dlx", "npx", "bunx", "yarn add"];

/** Longest-first, so `npm install` is not eaten by the `npm i` alternative. */
const RUNNER_ALT = [...RUNNERS].sort((a, b) => b.length - a.length).join("|");

/**
 * An install command naming a @usegraft package, with whatever tag it carries.
 *
 * Anchored on the runner so prose mentioning a package name is left alone —
 * only a line someone would paste into a terminal is rewritten. The runner is
 * captured because it decides the answer: see EPHEMERAL below.
 *
 * Flags are `-{1,2}` because they used to be `-\w+`, which matches `-D` and
 * silently does not match `--yes`: the whole command then failed to match, and
 * a command that does not match is one this script reports as fine. That is the
 * worst failure mode available to a checker — `npx --yes @usegraft/cli init`
 * passed `--check` with no tag at all. The separator is `[\s=]+` so
 * `--package=@usegraft/cli` is seen too, rather than the `=` form slipping the
 * same way the long flag did.
 */
const INSTALL = new RegExp(
  String.raw`((${RUNNER_ALT})(?:\s+-{1,2}[A-Za-z][\w-]*)*[\s=]+@usegraft\/[a-z-]+)(@[a-z0-9.-]+)?`,
  "g",
);

/**
 * The same command as an MCP client writes it: a runner in `"command"` and the
 * package as one string in `"args"`.
 *
 * This is not a variant worth skipping. `.mcp.json` is the longest-lived copy
 * of an install command we publish — an agent wires it once and re-runs it for
 * months, which is precisely the window in which npx's cache goes stale. The
 * README shipped `["-y", "@usegraft/cli", "mcp"]` with no tag, and the old
 * matcher could not see it, so `--check` called it fine.
 *
 * `[^}]*?` stays inside the one object, and the tag is captured before the
 * closing quote so an existing `@beta` is replaced rather than appended to.
 */
const JSON_ARGS = /("command"\s*:\s*"(npx|bunx)"[^}]*?"@usegraft\/[a-z-]+)(@[a-z0-9.-]+)?"/g;

/**
 * A runner and one of our packages close together on a line — whether or not
 * INSTALL could parse what sits between them.
 *
 * This is the guard the long-flag bug needed. INSTALL failing to match is
 * indistinguishable from compliance: both produce no rewrite, and `--check`
 * calls both OK. So after the strict matches are removed, anything still
 * looking like an install command is a command this script does not understand,
 * and it is reported rather than passed. **Widen INSTALL, never this** — the
 * point of the pair is that only one of them is allowed to be lenient.
 */
const UNPARSED = new RegExp(String.raw`(?:${RUNNER_ALT})[^\n]{0,40}?@usegraft\/[a-z-]+`);

/**
 * Runners that fetch, execute and discard — and cache what they fetched.
 *
 * `npx @usegraft/cli init` can re-run a copy npx downloaded weeks ago without
 * saying so, which is the failure this whole script exists to prevent, arriving
 * by a different road: the registry is right and the machine is stale. `@latest`
 * is what tells them to check. It is why `npx create-next-app@latest` is written
 * that way everywhere, and the reason is the cache, not decoration.
 *
 * The installers are left bare on purpose. `npm i @usegraft/core` already
 * resolves `latest` — writing it out adds a word that changes nothing, and a
 * tag that is sometimes meaningful and sometimes noise teaches a reader to stop
 * reading tags.
 */
const EPHEMERAL = new Set(["npx", "pnpm dlx", "bunx"]);

const want = (runner) => (EPHEMERAL.has(runner) ? "@latest" : "");

/** Apply the rule to one blob of text, in both spellings of a command. */
const retag = (text) =>
  text
    .replace(INSTALL, (_match, command, runner) => `${command}${want(runner)}`)
    .replace(JSON_ARGS, (_match, upToPackage, runner) => `${upToPackage}${want(runner)}"`);

/** Everything the matchers claim, removed — what is left should hold no command. */
const strip = (text) => text.replace(INSTALL, "").replace(JSON_ARGS, "");

/**
 * What the matcher must see, asserted before the matcher is trusted.
 *
 * This runs on every invocation rather than living in a test file, because the
 * bug it guards is one where the script reports success — a broken matcher and
 * a clean tree are the same output, so there is no run in which skipping these
 * would be safe. They are pure string work and cost nothing.
 *
 * `null` means the case must not be treated as an install command at all.
 */
const CASES = [
  ["npx @usegraft/cli init", "npx @usegraft/cli@latest init"],
  ["npx @usegraft/cli@latest init", "npx @usegraft/cli@latest init"],
  ["npx @usegraft/cli@beta init", "npx @usegraft/cli@latest init"],
  ["npx --yes @usegraft/cli init", "npx --yes @usegraft/cli@latest init"],
  ["npx -y @usegraft/cli init", "npx -y @usegraft/cli@latest init"],
  ["npx --package @usegraft/cli -- graft", "npx --package @usegraft/cli@latest -- graft"],
  ["npx --package=@usegraft/cli -- graft", "npx --package=@usegraft/cli@latest -- graft"],
  ["pnpm dlx @usegraft/cli init", "pnpm dlx @usegraft/cli@latest init"],
  ["bunx @usegraft/cli init", "bunx @usegraft/cli@latest init"],
  ["npm i @usegraft/core", "npm i @usegraft/core"],
  ["npm i @usegraft/core@latest", "npm i @usegraft/core"],
  ["npm i -D @usegraft/cli", "npm i -D @usegraft/cli"],
  ["npm i --save-dev @usegraft/cli", "npm i --save-dev @usegraft/cli"],
  ["npm install @usegraft/sdk-next", "npm install @usegraft/sdk-next"],
  ["pnpm add @usegraft/core", "pnpm add @usegraft/core"],
  ["yarn add @usegraft/core", "yarn add @usegraft/core"],
  [
    '{ "command": "npx", "args": ["-y", "@usegraft/cli", "mcp"] }',
    '{ "command": "npx", "args": ["-y", "@usegraft/cli@latest", "mcp"] }',
  ],
  [
    '{ "command": "npx", "args": ["-y", "@usegraft/cli@beta", "mcp"] }',
    '{ "command": "npx", "args": ["-y", "@usegraft/cli@latest", "mcp"] }',
  ],
  // Prose naming a package is not a command, and must survive untouched.
  ["the @usegraft/cli package", "the @usegraft/cli package"],
  ["read @usegraft/core@0.2.0 changelog", "read @usegraft/core@0.2.0 changelog"],
];

function selfTest() {
  const failures = [];
  for (const [input, expected] of CASES) {
    const actual = retag(input);
    if (actual !== expected)
      failures.push(`  ${input}\n    want: ${expected}\n    got:  ${actual}`);
    // Anything the rule rewrites must also be something the detector recognises,
    // or the two would disagree about what an install command is.
    const leftover = strip(actual);
    if (UNPARSED.test(leftover))
      failures.push(`  ${input}\n    strict matcher left an unparsed command behind`);
  }
  if (failures.length > 0) {
    console.error("install-tag matcher is broken — it does not do what it claims:\n");
    console.error(failures.join("\n"));
    process.exit(1);
  }
}

selfTest();

const changed = [];
const unparsed = [];

for (const file of targets()) {
  const before = readFileSync(file, "utf8");
  const after = retag(before);

  // Look for commands the strict matcher could not read, in the text left once
  // the ones it could read are removed.
  for (const [n, line] of strip(after).split("\n").entries()) {
    if (UNPARSED.test(line)) {
      unparsed.push(
        `${file.slice(root.length + 1).replaceAll("\\", "/")}:${n + 1}  ${line.trim()}`,
      );
    }
  }

  if (after === before) continue;
  changed.push(file.slice(root.length + 1).replaceAll("\\", "/"));
  if (!check) writeFileSync(file, after);
}

if (unparsed.length > 0) {
  console.error("install commands this script cannot read, so it cannot enforce the rule:\n");
  for (const hit of unparsed) console.error(`  ${hit}`);
  console.error(
    "\nRewrite the command in a form the matcher handles, or widen INSTALL in" +
      "\nthis file and add the new form to CASES. Silence here is not compliance.",
  );
  process.exit(1);
}

if (check) {
  if (changed.length > 0) {
    console.error("install commands do not match the tag rule:\n");
    for (const file of changed) console.error(`  ${file}`);
    console.error(
      "\nnpx / pnpm dlx / bunx take @latest so a cached copy is not silently reused;" +
        "\neverything else names the package alone. Run `pnpm install-tag` to fix.",
    );
    process.exit(1);
  }
  console.log(
    `install tags: OK — ${CASES.length} matcher cases pass, ephemeral runners carry @latest, installers carry nothing.`,
  );
  process.exit(0);
}

if (changed.length === 0) console.log("install tags: nothing to change.");
for (const file of changed) console.log(`  updated ${file}`);
