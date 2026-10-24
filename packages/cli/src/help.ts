/**
 * Help text, rendered from the registry. The root help lists commands by what
 * you would use them for; a command's help is its usage, what it does, its
 * flags and examples.
 */
import {
  COMMANDS,
  GROUPS,
  HELP_FLAG,
  commandId,
  commandsUnder,
  flagsOf,
  usageOf,
  type ArgSpec,
  type CommandSpec,
  type DatabaseNeed,
  type ExitCodeSpec,
  type FlagSpec,
  type Group,
} from "./registry";
import { ENVIRONMENT, EXIT_CODES, TOPICS, type EnvVarSpec, type TopicSpec } from "./topics";

const COLUMN = 22;

function row(left: string, right: string): string {
  return left.length >= COLUMN - 2
    ? `  ${left}\n${" ".repeat(COLUMN)}${right}`
    : `  ${left.padEnd(COLUMN - 2)}${right}`;
}

export function rootHelp(): string {
  const lines = ["graft — the agent-native CMS", "", "Usage: graft <command> [options]"];
  for (const [group, title] of Object.entries(GROUPS)) {
    lines.push("", `${title}:`);
    for (const spec of COMMANDS.filter((candidate) => candidate.group === group)) {
      lines.push(row(commandId(spec), spec.summary));
    }
  }
  lines.push(
    "",
    "Options:",
    row("-h, --help", "Show help; `graft <command> --help` for one command"),
    row("-v, --version", "Show the version"),
    "",
    "Help topics: " + TOPICS.map((topic) => topic.name).join(", ") + " (graft help <topic>)",
    "Scripts and agents: add --json to a command that prints data; see graft help json.",
  );
  return lines.join("\n");
}

function flagLine(flag: FlagSpec): string {
  const names = `${flag.short ? `-${flag.short}, ` : ""}--${flag.name}`;
  const value = flag.type === "boolean" ? "" : ` ${flag.value ?? "<value>"}`;
  const env = flag.env ? ` (or ${flag.env})` : "";
  const many = flag.multiple ? " Repeat it for more." : "";
  return row(`${names}${value}`, `${flag.summary}${env}.${many}`);
}

const WIDTH = 92;

/** A usage line too wide for a terminal, broken before a flag. */
function wrapUsage(usage: string): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of usage.split(/ (?=\[--)/)) {
    if (line && line.length + word.length + 1 > WIDTH) {
      lines.push(line);
      line = `    ${word}`;
    } else line = line ? `${line} ${word}` : word;
  }
  return [...lines, line];
}

/** Help for one command, or for every command under a family like `graft db`. */
export function commandHelp(words: readonly string[]): string | undefined {
  const exact = COMMANDS.find(
    (spec) => spec.path.length === words.length && spec.path.every((w, i) => w === words[i]),
  );
  // `graft branch create --help` is about create alone; `graft branch --help`
  // is about the whole family, the list included.
  const specs = exact && exact.path.length > 1 ? [exact] : commandsUnder(words);
  if (specs.length === 0) return undefined;

  const usages = specs.flatMap((spec) => wrapUsage(usageOf(spec)));
  const lines = [`Usage: ${usages[0]}`, ...usages.slice(1).map((usage) => `       ${usage}`)];
  for (const spec of specs) {
    lines.push("");
    if (specs.length > 1) lines.push(`graft ${commandId(spec)}: ${spec.summary}.`);
    if (spec.description) lines.push(...spec.description);
    else if (specs.length === 1) lines.push(`${spec.summary}.`);
  }

  // Each command's own flags first, then the ones every command of its kind
  // takes (--json, --no-input, --help).
  const own = specs.flatMap((spec) => spec.flags);
  const shared = specs.flatMap((spec) => flagsOf(spec)).filter((flag) => !own.includes(flag));
  const flags: FlagSpec[] = [];
  for (const flag of [...own, ...shared.filter((flag) => flag !== HELP_FLAG), HELP_FLAG]) {
    if (!flags.some((seen) => seen.name === flag.name)) flags.push(flag);
  }
  lines.push("", "Options:", ...flags.map(flagLine));

  const exits = specs.flatMap((spec) => spec.exitCodes ?? []);
  if (exits.length > 0) {
    lines.push("", "Exit codes:", ...exits.map((exit) => `  ${exit.code}  ${exit.meaning}`));
  }
  const examples = specs.flatMap((spec) => spec.examples ?? []);
  if (examples.length > 0)
    lines.push("", "Examples:", ...examples.map((example) => `  ${example}`));
  return lines.join("\n");
}

export function topicHelp(name: string): string | undefined {
  const topic: TopicSpec | undefined = TOPICS.find((candidate) => candidate.name === name);
  return topic && [`${topic.summary}.`, "", ...topic.body].join("\n");
}

/** `graft commands`: one line per command. */
export function commandList(): string {
  return COMMANDS.map((spec) => row(commandId(spec), spec.summary)).join("\n");
}

/** One command, as `graft commands --json` describes it. */
export interface CommandDescription {
  id: string;
  path: readonly string[];
  usage: string;
  summary: string;
  description: string | null;
  group: Group;
  args: readonly ArgSpec[];
  flags: FlagSpec[];
  json: boolean;
  database: DatabaseNeed;
  interactive: boolean;
  longRunning: boolean;
  exitCodes: readonly ExitCodeSpec[];
  examples: readonly string[];
}

export interface CliDescription {
  version: string;
  groups: typeof GROUPS;
  commands: CommandDescription[];
  exitCodes: readonly ExitCodeSpec[];
  environment: readonly EnvVarSpec[];
  topics: { name: string; summary: string }[];
}

/** `graft commands --json`: everything the help shows, as data. */
export function describeCli(version: string): CliDescription {
  return {
    version,
    groups: GROUPS,
    commands: COMMANDS.map((spec: CommandSpec) => ({
      id: commandId(spec),
      path: spec.path,
      usage: usageOf(spec),
      summary: spec.summary,
      description: spec.description?.join(" ") ?? null,
      group: spec.group,
      args: spec.args ?? [],
      flags: flagsOf(spec),
      json: spec.json === true,
      database: spec.database,
      interactive: spec.interactive === true,
      longRunning: spec.longRunning === true,
      exitCodes: spec.exitCodes ?? [],
      examples: spec.examples ?? [],
    })),
    exitCodes: EXIT_CODES,
    environment: ENVIRONMENT,
    topics: TOPICS.map((topic) => ({ name: topic.name, summary: topic.summary })),
  };
}
