/**
 * @usegraft/cli — the `graft` command.
 *
 * `init`/`compile`/`dev` (Phase 2), the approval + migration operator loops
 * (Phase 3), `branch`/`merge` (Phase 4), `add` (Phase 5), and `mcp` (Phase 6
 * project MCP over stdio) are real. Every failure crossing this boundary is a
 * GraftError printed with its agent-actionable `fix`.
 */
import { printGraftError } from "./report";

const VERSION = "0.0.0";

interface PlannedCommand {
  name: string;
  summary: string;
  phase: string;
}

// `add` shipped in Phase 5. Future not-yet-built commands can be listed here to
// print a "planned for Phase N" message instead of "unknown command".
const PLANNED: PlannedCommand[] = [];

function printHelp(): void {
  const lines = [
    "graft — the agent-native CMS",
    "",
    "Usage: graft <command> [options]",
    "",
    "Commands:",
    "  init [dir]   Scaffold a Graft project (graft.config.ts, content/, llms.txt)",
    "  compile      Project the content tree into the content index once",
    "  dev          Watch content/ + graft.config.ts and recompile on change",
    "  asset put <file> [key]   Upload a binary to the asset store (S3_* env)",
    "  approvals    List pending approvals for human-gated (destructive) function calls",
    "  approve <id> Approve a pending approval (the caller retries with x-graft-approval)",
    "  deny <id>    Deny a pending approval",
    "  migrate      Show pending content/data migrations (dry-run); --apply runs them",
    "  branch                   List branches (name, parent, backend)",
    "  branch create <name>     Register a preview branch (instant; --from <parent>, default main;",
    "                           --backend neon forks a physical Neon branch)",
    "  branch drop <name>       Drop a branch (overlay: purge rows; neon: delete the fork)",
    "  merge <name>             Merge a branch into --into (default main): replay ledger,",
    "                           move data rows, recompile. Dry-run; --apply executes",
    "  add <item>               Copy an owned primitive from the registry into graft/",
    "                           (+ its deps; regenerates the graft/ barrel — no config edit)",
    "  mcp                      Serve the project MCP over stdio (content + function tools;",
    "                           for .mcp.json / local agents). Requires DATABASE_URL.",
    "  serve                    Run the headless Graft runtime over HTTP: POST /api/fn/<name>,",
    "                           POST /api/mcp, GET /healthz (what a self-host container runs)",
    "  studio                   Opt-in Studio UI (edit content, approve/deny, OpenAPI)",
    "  content                  List the content tree from the compiled index (Studio parity)",
    "  compilations             List recent content projection trail rows (Studio parity)",
    "  harden <role>            Grant an existing Postgres role the runtime privilege set",
    "                           (can request + consume approvals but never decide them)",
    ...PLANNED.map((cmd) => `  ${cmd.name.padEnd(12)} ${cmd.summary}  (${cmd.phase})`),
    "",
    "Options:",
    "  --branch <id>    Content branch (compile/dev/migrate/mcp/serve/studio/content/compilations; default: main)",
    "  --port <n>       Port for `graft serve` / `graft studio` (serve default 3903; studio 4983)",
    "  --host <h>       Host for `graft serve` / `graft studio` (default: 127.0.0.1, or HOST)",
    "  --studio         Mount opt-in Studio on `graft serve` at /studio (or GRAFT_STUDIO=1)",
    "  --from <name>    Parent to fork from (branch create; default: main)",
    "  --into <name>    Merge target (merge; default: main)",
    "  --backend <kind> Branch backend: overlay (default) or neon (branch create)",
    "  --apply          Execute pending migrations / the merge (default is a dry-run report)",
    "  --dry-run        Preview `graft add` without writing",
    "  --overwrite      Let `graft add` replace files that differ",
    "  --prune-unknown  Let `graft compile` remove index rows in collections this schema",
    "                   doesn't know (default: refuse — the shared-DATABASE_URL guard)",
    "  -h, --help       Show this help",
    "  -v, --version    Show version",
  ];
  console.log(lines.join("\n"));
}

interface ParsedArgs {
  positionals: string[];
  branchId?: string;
  from?: string;
  into?: string;
  backend?: string;
  port?: number;
  host?: string;
  apply: boolean;
  dryRun: boolean;
  overwrite: boolean;
  pruneUnknown: boolean;
  studio: boolean;
}

class UsageError extends Error {}

/** Minimal flag parsing; throws UsageError on bad input. */
function parseArgs(rest: string[]): ParsedArgs {
  const positionals: string[] = [];
  let branchId: string | undefined;
  let from: string | undefined;
  let into: string | undefined;
  let backend: string | undefined;
  let port: number | undefined;
  let host: string | undefined;
  let apply = false;
  let dryRun = false;
  let overwrite = false;
  let pruneUnknown = false;
  let studio = false;

  const value = (flag: string, raw: string | undefined): string => {
    if (!raw || raw.startsWith("-")) {
      throw new UsageError(`${flag} requires a value, e.g. ${flag} main`);
    }
    return raw;
  };

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i] as string;
    if (arg === "--branch" || arg === "-b") {
      branchId = value("--branch", rest[++i]);
    } else if (arg === "--from") {
      from = value("--from", rest[++i]);
    } else if (arg === "--into") {
      into = value("--into", rest[++i]);
    } else if (arg === "--backend") {
      backend = value("--backend", rest[++i]);
    } else if (arg === "--port") {
      const raw = rest[++i];
      // "0" (pick a free port) is valid, so validate as a number, not a flag shape.
      if (raw === undefined || !/^\d+$/.test(raw)) {
        throw new UsageError("--port requires a number, e.g. --port 3903");
      }
      port = Number(raw);
    } else if (arg === "--host") {
      host = value("--host", rest[++i]);
    } else if (arg === "--apply") {
      apply = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--overwrite") {
      overwrite = true;
    } else if (arg === "--prune-unknown") {
      pruneUnknown = true;
    } else if (arg === "--studio") {
      studio = true;
    } else if (arg.startsWith("-")) {
      throw new UsageError(`unknown option "${arg}"`);
    } else {
      positionals.push(arg);
    }
  }
  return {
    positionals,
    branchId,
    from,
    into,
    backend,
    port,
    host,
    apply,
    dryRun,
    overwrite,
    pruneUnknown,
    studio,
  };
}

export interface RunOptions {
  cwd?: string;
}

export async function run(argv: string[], options: RunOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const [command, ...rest] = argv;

  if (command === "-v" || command === "--version") {
    console.log(VERSION);
    return 0;
  }
  if (!command || command === "-h" || command === "--help") {
    printHelp();
    return 0;
  }

  try {
    const args = parseArgs(rest);

    switch (command) {
      case "init": {
        const { initCommand } = await import("./commands/init");
        const result = initCommand({ targetDir: args.positionals[0] ?? cwd });
        console.log(
          `Initialized a Graft project in ${result.projectDir} (${result.created.length} file(s)):`,
        );
        for (const file of result.created) console.log(`  created ${file}`);
        console.log(
          [
            "",
            "Next steps:",
            "  1. Install the runtime: add @usegraft/core and zod (plus @usegraft/cli as a dev dep)",
            "  2. Put DATABASE_URL=postgres://… in .env",
            "  3. Run `graft compile` once, or keep `graft dev` running while you edit",
          ].join("\n"),
        );
        return 0;
      }
      case "compile": {
        const { compileCommand } = await import("./commands/compile");
        await compileCommand({ cwd, branchId: args.branchId, pruneUnknown: args.pruneUnknown });
        return 0;
      }
      case "dev": {
        const { devCommand } = await import("./commands/dev");
        await devCommand({ cwd, branchId: args.branchId });
        return 0;
      }
      case "asset": {
        const [subcommand, file, key] = args.positionals;
        if (subcommand !== "put" || !file) {
          throw new UsageError("usage: graft asset put <file> [key]");
        }
        const { assetPutCommand } = await import("./commands/asset");
        const result = await assetPutCommand({ cwd, file, key });
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
        return 0;
      }
      case "approvals": {
        const { approvalsListCommand, formatApproval } = await import("./commands/approvals");
        const pending = await approvalsListCommand({ cwd });
        if (pending.length === 0) {
          console.log("No pending approvals.");
          return 0;
        }
        console.log(`${pending.length} pending approval(s):\n`);
        for (const row of pending) console.log(`${formatApproval(row)}\n`);
        console.log("Decide with `graft approve <id>` or `graft deny <id>`.");
        return 0;
      }
      case "approve":
      case "deny": {
        const id = args.positionals[0];
        if (!id) throw new UsageError(`usage: graft ${command} <approval-id>`);
        const { decideCommand } = await import("./commands/approvals");
        const decision = command === "approve" ? "approved" : "denied";
        const row = await decideCommand({ cwd, id, decision });
        console.log(
          `${decision}: ${row.functionName} ${JSON.stringify(row.input)} (by ${row.decidedBy})`,
        );
        if (decision === "approved") {
          console.log(
            `The caller can now retry the exact same request with the header \`x-graft-approval: ${row.id}\` (one-shot).`,
          );
        }
        return 0;
      }
      case "migrate": {
        const { migrateCommand } = await import("./commands/migrate");
        await migrateCommand({ cwd, branchId: args.branchId, apply: args.apply });
        return 0;
      }
      case "branch": {
        const [subcommand, name] = args.positionals;
        // Usage validation before the (heavy) command module loads.
        if (subcommand && subcommand !== "create" && subcommand !== "drop") {
          throw new UsageError(
            `unknown branch subcommand "${subcommand}" — use \`graft branch\`, \`graft branch create <name>\`, or \`graft branch drop <name>\``,
          );
        }
        if (subcommand && !name) {
          throw new UsageError(`usage: graft branch ${subcommand} <name>`);
        }
        const mod = await import("./commands/branch");
        if (!subcommand) {
          const rows = await mod.branchListCommand({ cwd });
          if (rows.length === 0) {
            console.log("No branches registered (main is seeded by migration 0006).");
            return 0;
          }
          for (const row of rows) console.log(mod.formatBranch(row));
          return 0;
        }
        if (subcommand === "create" && name) {
          const meta = await mod.branchCreateCommand({
            cwd,
            name,
            from: args.from,
            backend: args.backend,
          });
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
          return 0;
        }
        // drop — the only remaining case after the usage validation above.
        const result = await mod.branchDropCommand({ cwd, name: name as string });
        const p = result.purged;
        console.log(
          result.backend === "neon"
            ? `Dropped neon branch "${name}" (the fork and its endpoint were deleted).`
            : `Dropped branch "${name}"` +
                (p
                  ? ` (purged ${p.content} content, ${p.data} data, ${p.ledger} ledger row(s)).`
                  : "."),
        );
        return 0;
      }
      case "merge": {
        const branch = args.positionals[0];
        if (!branch)
          throw new UsageError("usage: graft merge <branch> [--into <target>] [--apply]");
        const { mergeCommand } = await import("./commands/merge");
        await mergeCommand({ cwd, branch, into: args.into, apply: args.apply });
        return 0;
      }
      case "add": {
        const { addCommand } = await import("./commands/add");
        await addCommand({
          cwd,
          names: args.positionals,
          dryRun: args.dryRun,
          overwrite: args.overwrite,
        });
        return 0;
      }
      case "mcp": {
        const { mcpCommand } = await import("./commands/mcp");
        // Blocks until the MCP client disconnects (stdio lifetime).
        await mcpCommand({ cwd, branchId: args.branchId });
        return 0;
      }
      case "serve": {
        const { serveCommand } = await import("./commands/serve");
        // Blocks until SIGINT/SIGTERM (server lifetime).
        await serveCommand({
          cwd,
          branchId: args.branchId,
          port: args.port,
          host: args.host,
          studio: args.studio,
        });
        return 0;
      }
      case "studio": {
        const { studioCommand } = await import("./commands/studio");
        await studioCommand({
          cwd,
          branchId: args.branchId,
          port: args.port,
          host: args.host,
        });
        return 0;
      }
      case "content": {
        const { contentListCommand, formatContentLine } = await import("./commands/content");
        const { branch, lines } = await contentListCommand({ cwd, branchId: args.branchId });
        if (lines.length === 0) {
          console.log(`No content on branch "${branch}" (run graft compile).`);
          return 0;
        }
        console.log(`${lines.length} document(s) on branch "${branch}":\n`);
        for (const line of lines) console.log(formatContentLine(line));
        return 0;
      }
      case "compilations": {
        const { compilationsListCommand, formatCompilation } =
          await import("./commands/compilations");
        const rows = await compilationsListCommand({ cwd, branchId: args.branchId });
        if (rows.length === 0) {
          console.log("No compilations recorded yet (run graft compile).");
          return 0;
        }
        for (const row of rows) console.log(formatCompilation(row));
        return 0;
      }
      case "harden": {
        const role = args.positionals[0];
        if (!role) throw new UsageError("usage: graft harden <role>");
        const { hardenCommand } = await import("./commands/harden");
        const result = await hardenCommand({ cwd, role });
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
        return 0;
      }
      default: {
        const planned = PLANNED.find((cmd) => cmd.name === command);
        if (planned) {
          console.error(
            `graft: "${planned.name}" is planned for ${planned.phase} and is not implemented yet.`,
          );
          return 1;
        }
        console.error(`graft: unknown command "${command}"\n`);
        printHelp();
        return 1;
      }
    }
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`graft: ${error.message}`);
      return 1;
    }
    // Loaded at catch time: contracts pulls in Zod, and `--help`/`--version`/
    // usage errors should not pay for it.
    const { GraftError } = await import("@usegraft/contracts");
    if (error instanceof GraftError) {
      printGraftError(error);
      return 1;
    }
    throw error;
  }
}
