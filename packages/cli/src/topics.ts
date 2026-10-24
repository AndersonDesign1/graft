/**
 * The help topics: what `graft help <topic>` prints, what `graft commands
 * --json` describes, and what the generated CLI reference shows. Data only,
 * for the same reason as registry.ts.
 */
import type { ExitCodeSpec } from "./registry";

/** What every command's exit code means, unless its own help says otherwise. */
export const EXIT_CODES: readonly ExitCodeSpec[] = [
  { code: 0, meaning: "It worked" },
  { code: 1, meaning: "It failed; the error says why and what to do" },
  {
    code: 2,
    meaning:
      "The command was called wrong: an unknown command or flag, or a missing argument. Nothing ran",
  },
  {
    code: 3,
    meaning: "A person has to approve the action first. Run `graft approve <id>`, then repeat it",
  },
  { code: 4, meaning: "The credential is missing, wrong, or lacks the access this needs" },
];

/** Which GraftError codes map to which exit code; anything else is 1. */
export const EXIT_FOR_ERROR: ReadonlyMap<string, number> = new Map([
  ["USAGE_INVALID", 2],
  ["DESTRUCTIVE_OP_REQUIRES_APPROVAL", 3],
  ["UNAUTHORIZED", 4],
  ["TOKEN_INVALID", 4],
]);

export interface EnvVarSpec {
  readonly name: string;
  readonly summary: string;
}

/**
 * Environment variables that change how the CLI itself behaves. A project's
 * own settings (DATABASE_URL, S3_*, GRAFT_STUDIO_SECRET and the rest) are on
 * the Configuration page.
 */
export const ENVIRONMENT: readonly EnvVarSpec[] = [
  {
    name: "DATABASE_URL",
    summary:
      "The Postgres database. Read from the environment, or from `.env` in this folder or any folder above it",
  },
  { name: "GRAFT_DEBUG", summary: "Set to 1 to print the stack trace of an unexpected error" },
  {
    name: "GRAFT_PROMPT_DISABLED",
    summary: "Set to 1 to never ask a question, as `--no-input` does",
  },
  {
    name: "GRAFT_NO_UPDATE_CHECK",
    summary: "Set to 1 to never check npm for a newer Graft. Also read from `.env`",
  },
  { name: "CI", summary: "When set, the update check is off" },
  { name: "NO_COLOR", summary: "When set, never print color" },
  { name: "FORCE_COLOR", summary: "When set, print color even when the output is not a terminal" },
  { name: "CLICOLOR", summary: "Set to 0 to turn color off on a terminal" },
  { name: "CLICOLOR_FORCE", summary: "Same as `FORCE_COLOR`" },
  { name: "TERM", summary: "`dumb` turns color off" },
  {
    name: "XDG_CACHE_HOME",
    summary: "Where the update check caches its answer, under `graft/` (default: `~/.cache`)",
  },
  { name: "npm_config_registry", summary: "The npm registry the update check asks" },
];

export interface TopicSpec {
  readonly name: string;
  readonly summary: string;
  readonly body: readonly string[];
}

export const TOPICS: readonly TopicSpec[] = [
  {
    name: "exit-codes",
    summary: "What each exit code means",
    body: [
      "Every graft command exits with one of these. A command whose help lists its",
      "own codes (graft doctor, graft check, graft ci skip-build) uses those instead.",
      "",
      ...EXIT_CODES.map((exit) => `  ${String(exit.code).padStart(2)}  ${exit.meaning}`),
    ],
  },
  {
    name: "json",
    summary: "Read graft's output from a script or an agent",
    body: [
      "Commands that print data take --json. They then print one JSON object on",
      "stdout and nothing else: progress and messages go to stderr. The object is",
      "indented on a terminal and on one line when piped.",
      "",
      "When a command run with --json fails, stderr gets one line of JSON:",
      "",
      '  {"error":"CONFIG_NOT_FOUND","message":"…","fix":"…","details":{…}}',
      "",
      "`error` is a code from the error reference in the docs, and `fix` is the",
      "next step. The exit code says what kind of failure it was",
      "(graft help exit-codes).",
      "",
      "graft commands --json describes every command, its arguments and flags.",
    ],
  },
  {
    name: "environment",
    summary: "Environment variables the CLI reads",
    body: [
      "These change how the CLI behaves. Your project's own settings are on the",
      "Configuration page of the docs.",
      "",
      ...ENVIRONMENT.map((env) => `  ${env.name.padEnd(22)} ${env.summary}`),
    ],
  },
];
