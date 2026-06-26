/**
 * @graft/cli — the `graft` command.
 *
 * Phase 0: prints help/version and lists planned commands with the phase that
 * delivers them. No command behavior is implemented yet.
 */

const VERSION = "0.0.0";

interface CommandInfo {
  name: string;
  summary: string;
  phase: string;
}

const COMMANDS: CommandInfo[] = [
  { name: "init", summary: "Scaffold a new Graft project", phase: "Phase 2" },
  { name: "dev", summary: "Run the compiler + local engine in watch mode", phase: "Phase 2" },
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
    ...COMMANDS.map((cmd) => `  ${cmd.name.padEnd(10)} ${cmd.summary}  (${cmd.phase})`),
    "",
    "Options:",
    "  -h, --help       Show this help",
    "  -v, --version    Show version",
    "",
    "Status: Phase 0 — foundations only. Commands are not implemented yet.",
  ];
  console.log(lines.join("\n"));
}

function main(argv: string[]): number {
  const first = argv[0];

  if (first === "-v" || first === "--version") {
    console.log(VERSION);
    return 0;
  }

  if (!first || first === "-h" || first === "--help") {
    printHelp();
    return 0;
  }

  const known = COMMANDS.find((cmd) => cmd.name === first);
  if (known) {
    console.error(
      `graft: "${known.name}" is planned for ${known.phase} and is not implemented yet.`,
    );
    return 1;
  }

  console.error(`graft: unknown command "${first}"\n`);
  printHelp();
  return 1;
}

process.exit(main(process.argv.slice(2)));
