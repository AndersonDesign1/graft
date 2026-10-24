/**
 * graft create — a new site from nothing, in one command: `npm create graft`
 * runs it. It asks three plain questions (or reads them from flags, so an
 * agent can run it with no prompts), writes a template, makes or connects a
 * database, installs, migrates, loads the example content and compiles.
 *
 * The answers decide the storage: editing online keeps content in the
 * database and needs Postgres; editing in code keeps it in git, and needs no
 * database at all unless one is given.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { CLAIMABLE_DATABASE_FILE } from "@usegraft/compiler";
import { GraftError } from "@usegraft/contracts";
import { createClaimableDatabase, type NewDatabase } from "../create/neon";
import { scaffoldFiles, type Framework } from "../create/scaffold";
import {
  TEMPLATE_NAMES,
  isTemplateName,
  templateFor,
  type TemplateName,
} from "../create/templates";
import { VERSION } from "../version";

export type EditMode = "online" | "code";

export interface CreateOptions {
  /** Where to create the site; must be empty or missing. */
  dir: string;
  template?: string;
  framework?: string;
  edit?: string;
  /** "new" for a free claimable database, "none", or a Postgres URL. */
  database?: string;
  /** Use the defaults for every question not answered by a flag. */
  yes?: boolean;
  /** False never asks, as if stdin were not a terminal (--no-input). */
  input?: boolean;
  install?: boolean;
  /** Overridable for tests: the network, the installer, the terminal. */
  fetch?: typeof fetch;
  runInstall?: (dir: string, packageManager: string) => void;
  ask?: (question: string, choices: string[], fallback: string) => Promise<string>;
  log?: (line: string) => void;
}

export interface CreateResult {
  projectDir: string;
  template: TemplateName;
  framework: Framework;
  source: "git" | "database";
  index: "static" | "postgres";
  files: string[];
  database: "new" | "own" | "none";
  claimUrl?: string;
  installed: boolean;
  /** What to run next, in order. */
  next: string[];
}

const DEFAULTS = { template: "blog", framework: "next", edit: "online", database: "new" } as const;

/** The folder's name as an npm package name: lowercase, no leading dot or dash. */
export function packageName(dir: string): string {
  const name = basename(dir)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-");
  // Trimmed by index, not by a regex: an anchored alternation backtracks on a
  // long run of dashes, and the folder name is whatever the person typed.
  let start = 0;
  let end = name.length;
  while (start < end && "._-".includes(name[start] ?? "")) start += 1;
  while (end > start && name[end - 1] === "-") end -= 1;
  return name.slice(start, end) || "my-site";
}

function isPostgresUrl(value: string): boolean {
  return /^postgres(ql)?:\/\//.test(value);
}

/** The package manager that ran us (`npm create`, `pnpm create`, …), else npm. */
function packageManager(): string {
  const agent = process.env.npm_config_user_agent ?? "";
  for (const pm of ["pnpm", "yarn", "bun"]) if (agent.startsWith(pm)) return pm;
  return "npm";
}

function defaultInstall(dir: string, pm: string): void {
  const result = spawnSync(pm, ["install"], {
    cwd: dir,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new GraftError({
      code: "COMMIT_FAILED",
      message: `${pm} install failed in ${dir}.`,
      fix: `Run \`${pm} install\` in that folder to see why, then \`npx graft doctor\` for the rest of the setup.`,
    });
  }
}

/** A question on the terminal, answered by number or name; Enter takes the default. */
async function askOnTerminal(
  question: string,
  choices: string[],
  fallback: string,
): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const listed = choices.map((choice, i) => `  ${i + 1}. ${choice}`).join("\n");
      const answer = (await rl.question(`${question}\n${listed}\n> `)).trim();
      if (answer === "") return fallback;
      const byNumber = choices[Number(answer) - 1];
      if (byNumber) return byNumber;
      if (choices.includes(answer)) return answer;
    }
  } finally {
    rl.close();
  }
}

function refuse(flag: string, value: string, allowed: readonly string[]): never {
  throw new GraftError({
    code: "INPUT_VALIDATION_FAILED",
    message: `--${flag} ${value} isn't one of the choices.`,
    fix: `Use --${flag} with one of: ${allowed.join(", ")}.`,
  });
}

export async function createCommand(options: CreateOptions): Promise<CreateResult> {
  const log = options.log ?? ((line: string) => console.log(line));
  const projectDir = resolve(options.dir);
  if (existsSync(projectDir) && readdirSync(projectDir).some((name) => name !== ".git")) {
    throw new GraftError({
      code: "ALREADY_INITIALIZED",
      message: `${projectDir} isn't empty.`,
      fix: "Choose a new folder name, such as `npm create graft my-site`. To add Graft to a project you already have, run `npx graft init` in it.",
    });
  }

  const interactive =
    !options.yes && options.input !== false && Boolean(process.stdin.isTTY) && !options.ask;
  const ask =
    options.ask ??
    (interactive ? askOnTerminal : async (_q: string, _c: string[], fallback: string) => fallback);

  // ---- the three questions ------------------------------------------------
  const template =
    options.template ??
    (await ask(
      `What kind of site? (${TEMPLATE_NAMES.map((name) => `${name}: ${templateFor(name).summary}`).join("; ")})`,
      [...TEMPLATE_NAMES],
      DEFAULTS.template,
    ));
  if (!isTemplateName(template)) refuse("template", template, TEMPLATE_NAMES);

  const edit =
    options.edit ??
    (await ask(
      "How will people change the content? online: in Studio, in a browser, live as soon as it's published. code: as files in git, like the rest of the site.",
      ["online", "code"],
      DEFAULTS.edit,
    ));
  if (edit !== "online" && edit !== "code") refuse("edit", edit, ["online", "code"]);

  let database =
    options.database ??
    (await ask(
      edit === "online"
        ? "Editing online needs a Postgres database. new: make a free one for me now (claim it within 72 hours to keep it). url: use one I already have."
        : "Use a database? none: not needed, the site compiles to a file. new: make a free one (for Studio accounts and editing online later). url: use one I already have.",
      edit === "online" ? ["new", "url"] : ["none", "new", "url"],
      edit === "online" ? DEFAULTS.database : "none",
    ));
  if (database === "url") {
    database = interactive
      ? await (async () => {
          const rl = createInterface({ input: process.stdin, output: process.stdout });
          try {
            return (await rl.question("Paste the database URL (postgres://…):\n> ")).trim();
          } finally {
            rl.close();
          }
        })()
      : "";
  }
  if (database !== "new" && database !== "none" && !isPostgresUrl(database)) {
    refuse("database", database || "url", ["new", "none", "postgres://…"]);
  }
  if (edit === "online" && database === "none") {
    throw new GraftError({
      code: "NEEDS_DATABASE",
      message: "Editing online keeps the content in a database, so it needs one.",
      fix: "Use --database new for a free one, or --database postgres://… for your own.",
    });
  }

  const framework =
    options.framework ??
    (await ask(
      "Make the website too? next: a Next.js site that shows every collection. none: just the content, for a site you already have.",
      ["next", "none"],
      DEFAULTS.framework,
    ));
  if (framework !== "next" && framework !== "none")
    refuse("framework", framework, ["next", "none"]);

  const source = edit === "online" ? "database" : "git";
  const index = database === "none" ? "static" : "postgres";

  // ---- the database -------------------------------------------------------
  let created: NewDatabase | undefined;
  let url: string | undefined;
  if (database === "new") {
    log("Creating a free database…");
    created = await createClaimableDatabase(options.fetch);
    url = created.directUrl;
    log(`✓ Created a free database. Claim it within 72 hours to keep it: npx graft db claim`);
  } else if (database !== "none") {
    url = database;
  }

  // ---- the files ----------------------------------------------------------
  const files = scaffoldFiles({
    name: packageName(projectDir),
    template,
    framework,
    source,
    index,
    graftVersion: VERSION,
  });
  if (url) {
    files[".env"] = [
      "# Secrets: never commit this file.",
      `DATABASE_URL=${url}`,
      `GRAFT_STUDIO_SECRET=${randomBytes(48).toString("base64")}`,
      "",
    ].join("\n");
  }
  if (created) {
    const { url: _pooled, directUrl: _direct, ...claim } = created;
    files[CLAIMABLE_DATABASE_FILE] = `${JSON.stringify(claim, null, 2)}\n`;
  }
  for (const [path, body] of Object.entries(files)) {
    const target = join(projectDir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, body, path === ".env" ? { mode: 0o600 } : undefined);
  }
  log(
    `✓ Wrote a ${template} site${framework === "next" ? " with Next.js" : ""} in ${projectDir} (${Object.keys(files).length} files)`,
  );

  // ---- the schema, before anything needs it ------------------------------
  if (url) {
    const { runMigrations } = await import("@usegraft/db");
    const result = await runMigrations(url);
    log(`✓ Database ready (${result.applied.length} migrations applied)`);
  }

  // ---- install, then the steps that load the project's own schema ---------
  const pm = packageManager();
  const next: string[] = [];
  const install = options.install ?? true;
  if (install) {
    log(`Installing with ${pm}…`);
    (options.runInstall ?? defaultInstall)(projectDir, pm);
    log("✓ Installed");
    // The new site's database, whatever this shell already has set.
    if (url) process.env.DATABASE_URL = url;
    if (source === "database") {
      const { contentImportCommand } = await import("./content");
      const imported = await contentImportCommand({ cwd: projectDir });
      log(`✓ Loaded ${imported.imported.length} example entries into the database`);
    } else {
      const { compileCommand } = await import("./compile");
      await compileCommand({ cwd: projectDir });
      log("✓ Compiled the content");
    }
  } else {
    next.push(`${pm} install`);
    next.push(source === "database" ? "npx graft content import" : "npx graft compile");
  }

  const run = (script: string) => (pm === "npm" ? `npm run ${script}` : `${pm} ${script}`);
  next.push(
    framework === "next" ? `${run("dev")}   (the site, at http://localhost:3000)` : run("dev"),
  );
  next.push(`${run("studio")}   (Studio, the editor, at http://localhost:4983)`);
  const where = options.dir === "." ? "" : `cd ${options.dir}`;

  log("");
  log("Next:");
  if (where) log(`  ${where}`);
  for (const step of next) log(`  ${step}`);
  if (created) {
    log("");
    log(
      "The free database is deleted after 72 hours unless it is claimed. Run `npx graft db claim` to keep it, for free.",
    );
  }

  return {
    projectDir,
    template,
    framework,
    source,
    index,
    files: Object.keys(files).sort(),
    database: created ? "new" : url ? "own" : "none",
    ...(created ? { claimUrl: created.claimUrl } : {}),
    installed: install,
    next: where ? [where, ...next] : next,
  };
}
