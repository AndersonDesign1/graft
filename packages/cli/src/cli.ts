/**
 * @usegraft/cli — the `graft` command.
 *
 * registry.ts says what each command is called and takes; handlers.ts says
 * what it does. This file joins them: find the command, answer --help before
 * anything else, check its flags, run it, and turn the outcome into output
 * and an exit code (topics.ts EXIT_CODES). Every failure that reaches here is
 * printed with its code and its `fix`, as text or, under --json, as one JSON
 * line on stderr.
 */
import { parseCommand, resolveCommand, UsageError } from "./args";
import type { CommandContext } from "./handlers";
import { commandHelp, rootHelp } from "./help";
import { formatJson, reportError, withStdoutReserved } from "./output";
import { commandId, type CommandSpec } from "./registry";
import { promptsDisabled, useColor } from "./term";
import { checkForUpdate, formatUpdateNotice, updateCheckDisabled } from "./update-notice";
import { VERSION } from "./version";

function isHelpFlag(arg: string): boolean {
  return arg === "--help" || arg === "-h";
}

export interface RunOptions {
  cwd?: string;
  /**
   * The newer-version notice to print, if any. Defaults to asking npm (at most
   * once a day); off under CI, VITEST and GRAFT_NO_UPDATE_CHECK. Tests pass
   * their own so nothing reaches the network.
   */
  updateNotice?: () => Promise<string | undefined>;
}

async function defaultUpdateNotice(cwd: string): Promise<string | undefined> {
  if (updateCheckDisabled(process.env, cwd)) return undefined;
  const notice = await checkForUpdate({ current: VERSION, env: process.env });
  return notice && formatUpdateNotice(notice, useColor(process.env, process.stderr.isTTY));
}

export async function run(argv: string[], options: RunOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const [first] = argv;
  if (first === "-v" || first === "--version") {
    console.log(VERSION);
    return 0;
  }
  if (first === undefined || isHelpFlag(first)) {
    console.log(rootHelp());
    return 0;
  }

  // Before any parsing: a usage error should come back as JSON too when that
  // is what the caller reads.
  const json = argv.slice(0, endOfFlags(argv)).includes("--json");
  let spec: CommandSpec;
  let rest: string[];
  try {
    ({ spec, rest } = resolveCommand(argv));
  } catch (error) {
    return reportFailure(error, json);
  }

  // `graft <command> --help` anywhere after the name, answered before the
  // other arguments are checked: they may be incomplete or wrong, which is
  // often why someone asks.
  if (rest.slice(0, endOfFlags(rest)).some(isHelpFlag)) {
    console.log(commandHelp(spec.path));
    return 0;
  }

  // The notice is for a person: never on a protocol stream, never in JSON
  // mode, and started alongside the command so the registry round trip
  // overlaps its work.
  if (spec.updateCheck === false || json) return dispatch(spec, rest, cwd, json);
  const check = options.updateNotice ?? (() => defaultUpdateNotice(cwd));
  const pending = check().catch(() => undefined);
  const print = (notice: string | undefined): void => {
    if (notice) console.error(notice);
  };
  if (spec.longRunning) {
    void pending.then(print);
    return dispatch(spec, rest, cwd, json);
  }
  const code = await dispatch(spec, rest, cwd, json);
  print(await pending);
  return code;
}

/** Arguments after a bare `--` are values, never flags. */
function endOfFlags(argv: readonly string[]): number {
  const at = argv.indexOf("--");
  return at === -1 ? argv.length : at;
}

async function dispatch(
  spec: CommandSpec,
  rest: string[],
  cwd: string,
  json: boolean,
): Promise<number> {
  try {
    const { args, flags } = parseCommand(spec, rest);
    // Loaded only to run a command: --help and a typo never parse it.
    const { HANDLERS } = await import("./handlers");
    const handler = HANDLERS.get(commandId(spec));
    if (!handler) throw new Error(`graft ${commandId(spec)} has no handler.`);
    const ctx: CommandContext = {
      cwd,
      args,
      flags,
      json: spec.json === true && flags.bool("json"),
      noInput: spec.interactive === true && promptsDisabled(process.env, flags.bool("no-input")),
    };
    const outcome = ctx.json ? await withStdoutReserved(() => handler(ctx)) : await handler(ctx);
    if (ctx.json && outcome?.data) console.log(formatJson(outcome.data));
    return outcome?.exitCode ?? 0;
  } catch (error) {
    return reportFailure(error, json);
  }
}

/**
 * A GraftError keeps its code and fix; a UsageError is USAGE_INVALID. Anything
 * else is a bug, reported as INTERNAL_ERROR with the stack behind GRAFT_DEBUG.
 *
 * GraftError is recognized by its shape, not `instanceof`: loading the
 * contracts package (and Zod) just to print an error would slow every
 * failure, and a second copy of the package would fail the check anyway.
 */
function reportFailure(error: unknown, json: boolean): number {
  if (error instanceof UsageError) {
    return reportError(
      { code: "USAGE_INVALID", message: error.message, fix: error.fix, details: error.details },
      json,
    );
  }
  if (isGraftError(error)) return reportError(error, json);
  if (process.env.GRAFT_DEBUG) console.error(error);
  const message = error instanceof Error ? error.message : String(error);
  return reportError(
    {
      code: "INTERNAL_ERROR",
      message: `unexpected error: ${message}`,
      fix: process.env.GRAFT_DEBUG
        ? "The stack trace is above. If it points into graft.config.ts or your own code, fix it there; otherwise report it."
        : "Run it again with GRAFT_DEBUG=1 to see the stack trace.",
    },
    json,
  );
}

function isGraftError(
  error: unknown,
): error is { code: string; message: string; fix?: string; details?: Record<string, unknown> } {
  return (
    error instanceof Error &&
    error.name === "GraftError" &&
    "code" in error &&
    typeof error.code === "string"
  );
}
