/**
 * What each command does, keyed by its id in registry.ts.
 *
 * A handler prints for people and returns its answer as `data`. Under --json
 * the dispatcher points stdout at stderr while the handler runs and then
 * prints `data` alone, so a handler never has to think about the two modes;
 * it may skip text nobody will read when `ctx.json` is set.
 *
 * Every command module is imported inside its handler, so `graft --help`
 * and a usage error never load the database driver or the compiler.
 */
import type { Flags } from "./args";
import type { SyncCommandOptions } from "./commands/sync";
import { UsageError } from "./args";
import { commandHelp, commandList, describeCli, rootHelp, topicHelp } from "./help";
import { VERSION } from "./version";

export interface CommandContext {
  cwd: string;
  args: string[];
  flags: Flags;
  /** --json: return the answer as data; text goes to stderr. */
  json: boolean;
  /** --no-input or GRAFT_PROMPT_DISABLED: never ask a question. */
  noInput: boolean;
}

export interface CommandOutcome {
  /** The answer, printed as JSON under --json. Always an object. */
  data?: object;
  /** Overrides 0, for commands whose answer is a yes or no. */
  exitCode?: number;
}

export type Handler = (ctx: CommandContext) => Promise<CommandOutcome | void>;

const branchOf = (ctx: CommandContext): string | undefined => ctx.flags.string("branch");

const handlers = {
  /* ---- set up a project ------------------------------------------------- */

  async create(ctx) {
    const { createCommand } = await import("./commands/create");
    const { flags } = ctx;
    const template = flags.string("template");
    const edit = flags.string("edit");
    const database = flags.string("database");
    const framework = flags.string("framework");
    await createCommand({
      dir: ctx.args[0] ?? ".",
      ...(template ? { template } : {}),
      ...(edit ? { edit } : {}),
      ...(database ? { database } : {}),
      ...(framework ? { framework } : {}),
      yes: flags.bool("yes"),
      input: !ctx.noInput,
      install: !flags.bool("no-install"),
    });
  },

  async init(ctx) {
    const { initCommand } = await import("./commands/init");
    const { flags } = ctx;
    const driver = flags.bool("postgres")
      ? "postgres"
      : flags.bool("static")
        ? "static"
        : undefined;
    const result = initCommand({ targetDir: ctx.args[0] ?? ctx.cwd, driver });
    if (ctx.json) return { data: result };
    console.log(
      `Initialized a Graft project in ${result.projectDir} (${result.driver} index, ${result.created.length} file(s)):`,
    );
    for (const file of result.created) console.log(`  created ${file}`);
    console.log(
      result.driver === "static"
        ? [
            "",
            "Next steps — no database, no environment variables:",
            "  1. Install the runtime: add @usegraft/core and zod (plus @usegraft/cli as a dev dep)",
            "  2. Run `graft compile` once, or keep `graft dev` running while you edit",
            "",
            "The index compiles to .graft/index.db (git-ignored — it is derived from your",
            "files). Run `graft compile` before your app builds so it ships with the deploy.",
            "Need operational data, typed functions, or DB branching? Switch `index` to",
            '"postgres" in graft.config.ts and set DATABASE_URL.',
          ].join("\n")
        : [
            "",
            "Next steps:",
            "  1. Install the runtime: add @usegraft/core and zod (plus @usegraft/cli as a dev dep)",
            "  2. Put DATABASE_URL=postgres://… in .env",
            "  3. Run `graft compile` once, or keep `graft dev` running while you edit",
          ].join("\n"),
    );
    return { data: result };
  },

  async doctor(ctx) {
    const { doctorCommand } = await import("./commands/doctor");
    const status = await doctorCommand({ cwd: ctx.cwd });
    if (!ctx.json) {
      const { formatSetupStatus } = await import("@usegraft/compiler");
      console.log(formatSetupStatus(status));
    }
    return { data: status, exitCode: status.ready ? 0 : 1 };
  },

  async add(ctx) {
    const { addCommand } = await import("./commands/add");
    const result = await addCommand({
      cwd: ctx.cwd,
      names: ctx.args,
      dryRun: ctx.flags.bool("dry-run"),
      overwrite: ctx.flags.bool("overwrite"),
    });
    return { data: result };
  },

  /* ---- write and check content ----------------------------------------- */

  async compile(ctx) {
    const [{ compileBranch }, { compileJson }] = await Promise.all([
      import("./commands/compile"),
      import("./report"),
    ]);
    const compiled = await compileBranch({
      cwd: ctx.cwd,
      branchId: branchOf(ctx),
      pruneUnknown: ctx.flags.bool("prune-unknown"),
    });
    return { data: compileJson(compiled.branch, compiled.result) };
  },

  async dev(ctx) {
    const { devCommand } = await import("./commands/dev");
    await devCommand({ cwd: ctx.cwd, branchId: branchOf(ctx) });
  },

  async check(ctx) {
    const { checkCommand, formatProblem } = await import("./commands/check");
    const result = await checkCommand({ cwd: ctx.cwd });
    if (result.problems.length === 0) {
      console.log(`Checked ${result.documents} document(s): no problems.`);
      return { data: result };
    }
    if (!ctx.json) {
      for (const problem of result.problems) console.error(formatProblem(problem));
      console.error(`\n${result.problems.length} problem(s).`);
    }
    return { data: result, exitCode: 1 };
  },

  async content(ctx) {
    const { contentListCommand, formatContentLine } = await import("./commands/content");
    const { branch, lines } = await contentListCommand({ cwd: ctx.cwd, branchId: branchOf(ctx) });
    const data = { branch, documents: lines };
    if (ctx.json) return { data };
    if (lines.length === 0) {
      console.log(`No content on branch "${branch}" (run graft compile).`);
      return { data };
    }
    console.log(`${lines.length} document(s) on branch "${branch}":\n`);
    for (const line of lines) console.log(formatContentLine(line));
    return { data };
  },

  async compilations(ctx) {
    const { compilationsListCommand, formatCompilation } = await import("./commands/compilations");
    const rows = await compilationsListCommand({ cwd: ctx.cwd, branchId: branchOf(ctx) });
    const data = { branch: branchOf(ctx) ?? "main", compilations: rows };
    if (ctx.json) return { data };
    if (rows.length === 0) console.log("No compilations recorded yet (run graft compile).");
    for (const row of rows) console.log(formatCompilation(row));
    return { data };
  },

  async "asset put"(ctx) {
    const file = required(ctx, 0);
    const key = ctx.args[1];
    const { assetPutCommand } = await import("./commands/asset");
    const result = await assetPutCommand({
      cwd: ctx.cwd,
      file,
      key,
      overwrite: ctx.flags.bool("overwrite"),
    });
    if (ctx.json) return { data: result };
    console.log(`Uploaded ${result.key} (${result.contentType}, ${result.bytes} bytes)`);
    console.log(
      [
        "",
        "Reference it from an `asset` field in frontmatter:",
        `  image:`,
        `    key: ${result.key}`,
        "    alt: describe the image for screen readers",
      ].join("\n"),
    );
    return { data: result };
  },

  /* ---- run Graft --------------------------------------------------------- */

  async mcp(ctx) {
    const { mcpCommand } = await import("./commands/mcp");
    // Blocks until the MCP client disconnects (stdio lifetime).
    await mcpCommand({
      cwd: ctx.cwd,
      branchId: branchOf(ctx),
      elicitApprovals: ctx.flags.bool("elicit-approvals"),
    });
  },

  async serve(ctx) {
    const { serveCommand } = await import("./commands/serve");
    // Blocks until SIGINT/SIGTERM (server lifetime).
    await serveCommand({
      cwd: ctx.cwd,
      branchId: branchOf(ctx),
      port: ctx.flags.number("port"),
      host: ctx.flags.string("host"),
      studio: ctx.flags.bool("studio"),
    });
  },

  async studio(ctx) {
    const { studioCommand } = await import("./commands/studio");
    await studioCommand({
      cwd: ctx.cwd,
      branchId: branchOf(ctx),
      port: ctx.flags.number("port"),
      host: ctx.flags.string("host"),
    });
  },

  async "studio invite"(ctx) {
    const email = required(ctx, 0);
    const { studioInviteCommand } = await import("./commands/studio");
    const invite = await studioInviteCommand({
      cwd: ctx.cwd,
      email,
      name: ctx.flags.string("name"),
      role: ctx.flags.string("role"),
      days: ctx.flags.number("days"),
      url: ctx.flags.string("url"),
    });
    const data = { email, ...invite };
    if (ctx.json) return { data };
    console.log(
      [
        `Sign-in link for ${email} (${invite.role}), valid until ${invite.expiresAt.toISOString().slice(0, 10)}:`,
        "",
        `  ${invite.url}`,
        "",
        "Anyone holding this link can sign in as this person until it expires. Send it",
        "privately. Rotating GRAFT_STUDIO_SECRET revokes every link and session.",
      ].join("\n"),
    );
    return { data };
  },

  async "studio setup-code"(ctx) {
    const { studioSetupCodeCommand } = await import("./commands/studio");
    console.log(await studioSetupCodeCommand({ cwd: ctx.cwd }));
  },

  /* ---- keep content in the database ------------------------------------ */

  async "content import"(ctx) {
    const { contentImportCommand, formatImport } = await import("./commands/content");
    const result = await contentImportCommand({
      cwd: ctx.cwd,
      branchId: branchOf(ctx),
      dryRun: ctx.flags.bool("dry-run"),
    });
    if (!ctx.json) for (const line of formatImport(result)) console.log(line);
    return { data: result };
  },

  async pull(ctx) {
    const { formatPull, pullCommand } = await import("./commands/sync");
    const result = await pullCommand(syncOptions(ctx, false));
    if (!ctx.json) for (const line of formatPull(result)) console.log(line);
    return { data: result };
  },

  async push(ctx) {
    const { formatPush, pushCommand } = await import("./commands/sync");
    const result = await pushCommand(syncOptions(ctx, ctx.flags.bool("dry-run")));
    if (!ctx.json) for (const line of formatPush(result)) console.log(line);
    return { data: result };
  },

  async mirror(ctx) {
    const { formatMirror, mirrorCommand } = await import("./commands/sync");
    const result = await mirrorCommand({ cwd: ctx.cwd, branchId: branchOf(ctx) });
    if (!ctx.json) for (const line of formatMirror(result)) console.log(line);
    return { data: result };
  },

  /* ---- manage the database ---------------------------------------------- */

  async "db migrate"(ctx) {
    const { dbMigrateCommand, formatMigrateResult } = await import("./commands/db");
    const result = await dbMigrateCommand({ cwd: ctx.cwd, dryRun: ctx.flags.bool("dry-run") });
    if (!ctx.json) console.log(formatMigrateResult(result));
    return { data: result };
  },

  async "db claim"(ctx) {
    const { dbClaimCommand } = await import("./commands/db-claim");
    const url = ctx.flags.string("url");
    await dbClaimCommand({ cwd: ctx.cwd, input: !ctx.noInput, ...(url ? { url } : {}) });
  },

  async migrate(ctx) {
    const { migrateCommand } = await import("./commands/migrate");
    const result = await migrateCommand({
      cwd: ctx.cwd,
      branchId: branchOf(ctx),
      apply: ctx.flags.bool("apply"),
    });
    return { data: result };
  },

  async harden(ctx) {
    const { hardenCommand } = await import("./commands/harden");
    const result = await hardenCommand({ cwd: ctx.cwd, role: required(ctx, 0) });
    if (ctx.json) return { data: result };
    console.log(`Hardened runtime role "${result.role}" (${result.statements.length} grants):`);
    for (const statement of result.statements) console.log(`  ${statement}`);
    console.log(
      [
        "",
        "This role can request + consume approvals but can NEVER decide them",
        "(no UPDATE on approvals) or rewrite content projections. Hand its",
        "connection URL to the deployment as DATABASE_URL; keep the operator",
        "URL for graft compile/migrate/branch/merge/approve.",
      ].join("\n"),
    );
    return { data: result };
  },

  /* ---- approve actions --------------------------------------------------- */

  async approvals(ctx) {
    const { approvalsListCommand, formatApproval } = await import("./commands/approvals");
    const pending = await approvalsListCommand({ cwd: ctx.cwd });
    const data = { approvals: pending };
    if (ctx.json) return { data };
    if (pending.length === 0) {
      console.log("No pending approvals.");
      return { data };
    }
    console.log(`${pending.length} pending approval(s):\n`);
    for (const row of pending) console.log(`${formatApproval(row)}\n`);
    console.log("Decide with `graft approve <id>` or `graft deny <id>`.");
    return { data };
  },

  approve: (ctx) => decide(ctx, "approved"),
  deny: (ctx) => decide(ctx, "denied"),

  /* ---- work with preview branches --------------------------------------- */

  async branch(ctx) {
    const { branchListCommand, formatBranch } = await import("./commands/branch");
    const rows = await branchListCommand({ cwd: ctx.cwd });
    const data = { branches: rows };
    if (ctx.json) return { data };
    if (rows.length === 0) {
      console.log("No branches registered (main is seeded by migration 0006).");
      return { data };
    }
    for (const row of rows) console.log(formatBranch(row));
    return { data };
  },

  async "branch create"(ctx) {
    const { branchCreateCommand } = await import("./commands/branch");
    const meta = await branchCreateCommand({
      cwd: ctx.cwd,
      name: required(ctx, 0),
      from: ctx.flags.string("from"),
      backend: ctx.flags.string("backend"),
    });
    if (ctx.json) return { data: meta };
    console.log(
      meta.backend === "neon"
        ? [
            `Created neon branch "${meta.name}" from "${meta.parent}" — a physical fork at ${meta.endpointHost}.`,
            `Content is inherited; operational data and approvals start empty on the fork.`,
            `  graft compile --branch ${meta.name}   (routes to the fork automatically)`,
            `Merge it back with \`graft merge ${meta.name}\` when ready.`,
          ].join("\n")
        : [
            `Created branch "${meta.name}" from "${meta.parent}" (${meta.backend} — zero rows copied).`,
            `Reads overlay the parent until the branch writes its own rows:`,
            `  graft compile --branch ${meta.name}`,
            `Merge it back with \`graft merge ${meta.name}\` when ready.`,
          ].join("\n"),
    );
    return { data: meta };
  },

  async "branch drop"(ctx) {
    const name = required(ctx, 0);
    const { branchDropCommand } = await import("./commands/branch");
    const result = await branchDropCommand({ cwd: ctx.cwd, name });
    if (ctx.json) return { data: { name, ...result } };
    const p = result.purged;
    console.log(
      result.backend === "neon"
        ? `Dropped neon branch "${name}" (the fork and its endpoint were deleted).`
        : `Dropped branch "${name}"` +
            (p
              ? ` (purged ${p.content} content, ${p.data} data, ${p.ledger} ledger row(s)).`
              : "."),
    );
    return { data: { name, ...result } };
  },

  async merge(ctx) {
    const { mergeCommand } = await import("./commands/merge");
    const result = await mergeCommand({
      cwd: ctx.cwd,
      branch: required(ctx, 0),
      into: ctx.flags.string("into"),
      apply: ctx.flags.bool("apply"),
    });
    return { data: result };
  },

  /* ---- keep CI cheap ----------------------------------------------------- */

  async "ci changes"(ctx) {
    const { ciChanges, reportChanges } = await import("./commands/ci");
    const base = ctx.flags.string("base");
    const result = await ciChanges({ cwd: ctx.cwd, ...(base ? { base } : {}) });
    for (const line of reportChanges(result)) console.log(line);
    return { data: result };
  },

  async "ci skip-build"(ctx) {
    const { ciSkipBuild } = await import("./commands/ci");
    const base = ctx.flags.string("base");
    const result = await ciSkipBuild({ cwd: ctx.cwd, ...(base ? { base } : {}) });
    console.log(result.reason);
    return { data: result, exitCode: result.skip ? 0 : 1 };
  },

  async "ci init"(ctx) {
    const { ciInit } = await import("./commands/ci");
    for (const line of await ciInit({ cwd: ctx.cwd, overwrite: ctx.flags.bool("overwrite") })) {
      console.log(line);
    }
  },

  /* ---- learn the CLI ----------------------------------------------------- */

  async help(ctx) {
    if (ctx.args.length === 0) {
      console.log(rootHelp());
      return;
    }
    const text = topicHelp(ctx.args.join(" ")) ?? commandHelp(ctx.args);
    if (text === undefined) {
      throw new UsageError(
        `no command or help topic called "${ctx.args.join(" ")}".`,
        "Run `graft --help` to list the commands and topics.",
        { topic: ctx.args.join(" ") },
      );
    }
    console.log(text);
  },

  async commands(ctx) {
    const data = describeCli(VERSION);
    if (!ctx.json) console.log(commandList());
    return { data };
  },
} satisfies Record<string, Handler>;

/** Every command's handler, by the id registry.ts gives it. */
export const HANDLERS: ReadonlyMap<string, Handler> = new Map(Object.entries(handlers));

/** A required argument; the parser has already refused a call without it. */
function required(ctx: CommandContext, index: number): string {
  const value = ctx.args[index];
  if (value === undefined) throw new Error(`Argument ${index + 1} is missing.`);
  return value;
}

function syncOptions(ctx: CommandContext, dryRun: boolean): SyncCommandOptions {
  return {
    cwd: ctx.cwd,
    branchId: branchOf(ctx),
    only: [...ctx.args, ...ctx.flags.list("only")],
    force: ctx.flags.bool("force"),
    dryRun,
  };
}

async function decide(
  ctx: CommandContext,
  decision: "approved" | "denied",
): Promise<CommandOutcome> {
  const { decideCommand } = await import("./commands/approvals");
  const row = await decideCommand({ cwd: ctx.cwd, id: required(ctx, 0), decision });
  if (ctx.json) return { data: row };
  console.log(
    `${decision}: ${row.functionName} ${JSON.stringify(row.input)} (by ${row.decidedBy})`,
  );
  if (decision === "approved") {
    console.log(
      `The caller can now retry the exact same request with the header \`x-graft-approval: ${row.id}\` (one-shot).`,
    );
  }
  return { data: row };
}
