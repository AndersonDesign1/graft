/**
 * @graft/cli — the `graft` command.
 *
 * Phase 2: `init`, `compile`, and `dev` are real; `add`/`branch`/`merge` are
 * planned stubs that say which phase delivers them. Every failure crossing this
 * boundary is a GraftError printed with its agent-actionable `fix`.
 */
import { printGraftError } from "./report";

const VERSION = "0.0.0";

interface PlannedCommand {
  name: string;
  summary: string;
  phase: string;
}

const PLANNED: PlannedCommand[] = [
  { name: "add", summary: "Add an owned primitive from the registry", phase: "Phase 5" },
  { name: "branch", summary: "Create a content + database preview branch", phase: "Phase 4" },
  { name: "merge", summary: "Merge a branch, running content + DB migrations", phase: "Phase 4" },
];

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
    ...PLANNED.map((cmd) => `  ${cmd.name.padEnd(12)} ${cmd.summary}  (${cmd.phase})`),
    "",
    "Options:",
    "  --branch <id>    Content branch to project into (compile/dev; default: main)",
    "  -h, --help       Show this help",
    "  -v, --version    Show version",
  ];
  console.log(lines.join("\n"));
}

interface ParsedArgs {
  positionals: string[];
  branchId?: string;
}

class UsageError extends Error {}

/** Minimal flag parsing; throws UsageError on bad input. */
function parseArgs(rest: string[]): ParsedArgs {
  const positionals: string[] = [];
  let branchId: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i] as string;
    if (arg === "--branch" || arg === "-b") {
      branchId = rest[++i];
      if (!branchId || branchId.startsWith("-")) {
        throw new UsageError("--branch requires a value, e.g. --branch main");
      }
    } else if (arg.startsWith("-")) {
      throw new UsageError(`unknown option "${arg}"`);
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, branchId };
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
            "  1. Install the runtime: add @graft/core and zod (plus @graft/cli as a dev dep)",
            "  2. Put DATABASE_URL=postgres://… in .env",
            "  3. Run `graft compile` once, or keep `graft dev` running while you edit",
          ].join("\n"),
        );
        return 0;
      }
      case "compile": {
        const { compileCommand } = await import("./commands/compile");
        await compileCommand({ cwd, branchId: args.branchId });
        return 0;
      }
      case "dev": {
        const { devCommand } = await import("./commands/dev");
        await devCommand({ cwd, branchId: args.branchId });
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
    const { GraftError } = await import("@graft/contracts");
    if (error instanceof GraftError) {
      printGraftError(error);
      return 1;
    }
    throw error;
  }
}
