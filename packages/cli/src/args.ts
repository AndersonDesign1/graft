/**
 * From argv to a command and its flags, checked against the registry.
 *
 * A flag the command does not declare is refused rather than ignored: a
 * misspelt `--aply` that silently did nothing is how a dry run gets mistaken
 * for a real one. Every refusal is a UsageError that names the closest match.
 */
import {
  COMMANDS,
  commandId,
  commandsUnder,
  flagsOf,
  usageOf,
  type CommandSpec,
  type FlagSpec,
} from "./registry";
import { closest } from "./suggest";

/**
 * The command was called wrong. Kept apart from GraftError so `--help`,
 * `--version` and a typo never load the contracts package and Zod.
 */
export class UsageError extends Error {
  readonly fix: string;
  readonly details: Record<string, unknown>;
  constructor(message: string, fix: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "UsageError";
    this.fix = fix;
    this.details = details;
  }
}

const helpFix = (spec: CommandSpec): string => `Run \`graft ${commandId(spec)} --help\`.`;

const didYouMean = (suggestion: string | undefined): string =>
  suggestion ? `Did you mean \`${suggestion}\`? ` : "";

/** Error details, with the suggestion when there is one. */
function suggested(
  details: Record<string, unknown>,
  suggestion: string | undefined,
): Record<string, unknown> {
  if (suggestion !== undefined) details.suggestion = suggestion;
  return details;
}

export interface ResolvedCommand {
  spec: CommandSpec;
  /** Everything after the command's name. */
  rest: string[];
}

/** The command named by the leading words of argv, and everything after them. */
export function resolveCommand(argv: readonly string[]): ResolvedCommand {
  const words: string[] = [];
  for (const arg of argv) {
    if (arg.startsWith("-")) break;
    words.push(arg);
  }
  for (let length = words.length; length > 0; length--) {
    const prefix = words.slice(0, length);
    const spec = COMMANDS.find(
      (candidate) =>
        candidate.path.length === length && candidate.path.every((word, i) => word === prefix[i]),
    );
    if (spec) return { spec, rest: argv.slice(length) };
  }

  const [first, second] = words;
  if (first === undefined) {
    throw new UsageError("no command given.", "Run `graft --help` to list the commands.");
  }
  const family = commandsUnder([first]);
  if (family.length === 0) {
    const names = [...new Set(COMMANDS.map((spec) => spec.path[0] ?? ""))];
    const suggestion = closest(first, names);
    throw new UsageError(
      `unknown command "${first}".`,
      `${didYouMean(suggestion && `graft ${suggestion}`)}Run \`graft --help\` to list the commands.`,
      suggested({ command: first }, suggestion),
    );
  }
  // A family with no command of its own, like `graft db`: name its members.
  return subcommandError(first, second, family);
}

/** Throws for `graft db frob`, or `graft db` alone: names the family's commands. */
function subcommandError(
  family: string,
  typed: string | undefined,
  members: readonly CommandSpec[],
): never {
  const names = members.map((spec) => spec.path.slice(1).join(" ")).filter(Boolean);
  const list = names.map((name) => `graft ${family} ${name}`).join(", ");
  if (typed === undefined) {
    throw new UsageError(`missing a subcommand for graft ${family}.`, `Use one of: ${list}.`, {
      command: family,
    });
  }
  const suggestion = closest(typed, names);
  throw new UsageError(
    `unknown ${family} subcommand "${typed}".`,
    `${didYouMean(suggestion && `graft ${family} ${suggestion}`)}Use one of: ${list}.`,
    suggested({ command: family, subcommand: typed }, suggestion),
  );
}

type FlagValue = boolean | number | string | string[];

/** A command's parsed flags. Reading a flag the command never declared is a bug. */
export class Flags {
  readonly #spec: CommandSpec;
  readonly #values: ReadonlyMap<string, FlagValue>;

  constructor(spec: CommandSpec, values: ReadonlyMap<string, FlagValue>) {
    this.#spec = spec;
    this.#values = values;
  }

  #get(name: string): FlagValue | undefined {
    if (!flagsOf(this.#spec).some((flag) => flag.name === name)) {
      throw new Error(`graft ${commandId(this.#spec)} reads --${name}, which it does not declare.`);
    }
    return this.#values.get(name);
  }

  bool(name: string): boolean {
    return this.#get(name) === true;
  }

  string(name: string): string | undefined {
    const value = this.#get(name);
    return typeof value === "string" ? value : undefined;
  }

  number(name: string): number | undefined {
    const value = this.#get(name);
    return typeof value === "number" ? value : undefined;
  }

  list(name: string): string[] {
    const value = this.#get(name);
    return Array.isArray(value) ? value : [];
  }
}

export interface ParsedCommand {
  spec: CommandSpec;
  args: string[];
  flags: Flags;
}

/** Parse what follows the command's name against its declared flags and arguments. */
export function parseCommand(spec: CommandSpec, rest: readonly string[]): ParsedCommand {
  const declared = flagsOf(spec);
  const values = new Map<string, FlagValue>();
  const args: string[] = [];

  for (let i = 0; i < rest.length; i++) {
    const token = rest[i] ?? "";
    if (token === "--") {
      args.push(...rest.slice(i + 1));
      break;
    }
    if (!token.startsWith("-") || token === "-") {
      args.push(token);
      continue;
    }
    const long = token.startsWith("--");
    const eq = long ? token.indexOf("=") : -1;
    const name = long ? token.slice(2, eq === -1 ? undefined : eq) : token.slice(1);
    const inline = eq === -1 ? undefined : token.slice(eq + 1);
    const flag = declared.find((candidate) =>
      long ? candidate.name === name : candidate.short === name,
    );
    if (!flag) throw unknownFlag(spec, declared, eq === -1 ? token : token.slice(0, eq));

    if (flag.type === "boolean") {
      if (inline !== undefined) {
        throw new UsageError(`--${flag.name} takes no value.`, helpFix(spec), {
          flag: `--${flag.name}`,
        });
      }
      values.set(flag.name, true);
      continue;
    }

    let raw = inline;
    if (raw === undefined) {
      const next = rest[i + 1];
      if (next !== undefined && (!next.startsWith("-") || next === "-")) {
        raw = next;
        i++;
      }
    }
    if (raw === undefined || raw === "") throw missingValue(spec, flag);
    if (flag.type === "number") {
      if (!/^\d+$/.test(raw)) throw missingValue(spec, flag);
      values.set(flag.name, Number(raw));
    } else if (flag.multiple) {
      const previous = values.get(flag.name);
      values.set(flag.name, [...(Array.isArray(previous) ? previous : []), raw]);
    } else {
      values.set(flag.name, raw);
    }
  }

  checkArgs(spec, args);
  return { spec, args, flags: new Flags(spec, values) };
}

function unknownFlag(spec: CommandSpec, declared: readonly FlagSpec[], typed: string): UsageError {
  const names = declared.map((flag) => `--${flag.name}`);
  // Only a long flag can be a misspelling of a long flag; `-x` has no near miss.
  const hosted = typed === "--remote" || typed === "--local";
  const suggestion = typed.startsWith("--") && !hosted ? closest(typed, names) : undefined;
  const noJson = typed === "--json" ? `graft ${commandId(spec)} has no JSON output. ` : "";
  // Name the families, not all seventeen commands: graft content, graft drafts…
  const families = [
    ...new Set(
      COMMANDS.filter((other) => other.remote).map((other) =>
        other.path[0] === "mcp" ? `graft ${commandId(other)}` : `graft ${other.path[0]}`,
      ),
    ),
  ];
  const remote = hosted
    ? `graft ${commandId(spec)} works on the project in this folder only. ${typed} works with: ${families.join(", ")}. `
    : "";
  return new UsageError(
    `unknown option "${typed}" for graft ${commandId(spec)}.`,
    `${didYouMean(suggestion)}${noJson}${remote}${helpFix(spec)}`,
    suggested({ command: commandId(spec), flag: typed }, suggestion),
  );
}

function missingValue(spec: CommandSpec, flag: FlagSpec): UsageError {
  const kind = flag.type === "number" ? "a number" : "a value";
  const example = flag.example ?? flag.value ?? "<value>";
  return new UsageError(
    `--${flag.name} requires ${kind}, e.g. --${flag.name} ${example}`,
    helpFix(spec),
    { command: commandId(spec), flag: `--${flag.name}` },
  );
}

function checkArgs(spec: CommandSpec, args: readonly string[]): void {
  const declared = spec.args ?? [];
  const missing = declared.slice(args.length).find((arg) => arg.required);
  if (missing) {
    throw new UsageError(
      `missing <${missing.name}> for graft ${commandId(spec)}.`,
      `Usage: ${usageOf(spec)}`,
      { command: commandId(spec), argument: missing.name },
    );
  }
  if (declared.some((arg) => arg.variadic) || args.length <= declared.length) return;

  const extra = args[declared.length] ?? "";
  // `graft branch frob`: a word where a subcommand would go.
  const children = commandsUnder(spec.path).filter((child) => child !== spec);
  if (declared.length === 0 && children.length > 0) {
    subcommandError(spec.path.join(" "), extra, children);
  }
  throw new UsageError(
    `unexpected argument "${extra}" for graft ${commandId(spec)}.`,
    `Usage: ${usageOf(spec)}`,
    { command: commandId(spec), argument: extra },
  );
}
