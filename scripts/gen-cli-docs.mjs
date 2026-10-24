/**
 * The CLI reference is generated, not written.
 *
 * Every command, argument and flag is declared once, in
 * packages/cli/src/registry.ts, and `graft --help` renders from it. The docs
 * page and the README's command table used to be written by hand and had
 * drifted from the CLI in a dozen places: flags missing, commands filed under
 * the wrong heading. So both are derived from the same table, read through
 * `graft commands --json` (what an agent reads too), and CI asserts that
 * regenerating them changes nothing, as check:error-docs does for errors.
 *
 *   node scripts/gen-cli-docs.mjs           # write the page and the README table
 *   node scripts/gen-cli-docs.mjs --check   # fail if either is stale
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const PAGE = resolve(root, "examples/docs-site/content/docs/cli-reference.mdx");
const README = resolve(root, "packages/cli/README.md");
const CLI = resolve(root, "packages/cli/dist/index.js");
const START = "<!-- graft:commands:start -->";
const END = "<!-- graft:commands:end -->";

const check = process.argv.includes("--check");

let cli;
try {
  const out = execFileSync(process.execPath, [CLI, "commands", "--json"], {
    encoding: "utf8",
    env: { ...process.env, GRAFT_NO_UPDATE_CHECK: "1", NO_COLOR: "1" },
  });
  cli = JSON.parse(out);
} catch (error) {
  console.error(`Could not read \`graft commands --json\` from ${CLI}`);
  console.error("Run `pnpm build` first: this reads the built @usegraft/cli.");
  console.error(String(error));
  process.exit(1);
}

/** YAML-safe: the frontmatter strings come from code. */
const quote = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/**
 * The registry is written for a terminal, so it holds characters MDX parses
 * as syntax: `<name>` opens a JSX element and `{ source: "database" }` is an
 * expression. Escape `<` and `{` outside inline code, as gen-error-docs does.
 */
function escapeMdx(text) {
  let out = "";
  let inCode = false;
  for (const ch of String(text)) {
    if (ch === "`") {
      inCode = !inCode;
      out += ch;
      continue;
    }
    if (!inCode && (ch === "<" || ch === "{")) out += `\\${ch}`;
    else out += ch;
  }
  return out;
}

/**
 * A table cell: a literal pipe would end the cell, even inside code. Escape
 * backslashes too, so one already in the text cannot combine with the
 * escape added here. A scan rather than a regex replace, for the same reason
 * as escapeMdx.
 */
function cell(text) {
  let out = "";
  for (const ch of String(text)) out += ch === "|" || ch === "\\" ? `\\${ch}` : ch;
  return out;
}

const DATABASE = {
  always: "Needs `DATABASE_URL`.",
  postgres: "Needs `DATABASE_URL` on the Postgres engine; none on the static engine.",
  optional: "Uses `DATABASE_URL` when it is set, and works without it.",
  never: "Needs no database.",
};

function flagName(flag) {
  const value = flag.type === "boolean" ? "" : ` ${flag.value ?? "<value>"}`;
  return `${flag.short ? `-${flag.short}, ` : ""}--${flag.name}${value}`;
}

function flagMeaning(flag) {
  const env = flag.env ? ` Same as \`${flag.env}\`.` : "";
  const many = flag.multiple ? " Repeat it for more than one." : "";
  return `${flag.summary}.${env}${many}`;
}

function commandSection(command) {
  // The description, where there is one, says everything the summary does.
  const about = command.description ?? `${command.summary}.`;
  const lines = [`### \`graft ${command.id}\``, "", escapeMdx(about)];
  lines.push("", "```text", command.usage, "```");
  const flags = command.flags.filter((flag) => flag.name !== "help");
  if (flags.length > 0) {
    lines.push("", "| Flag | What it does |", "| --- | --- |");
    for (const flag of flags) {
      lines.push(`| \`${cell(flagName(flag))}\` | ${cell(escapeMdx(flagMeaning(flag)))} |`);
    }
  }
  const facts = [DATABASE[command.database]];
  if (command.json) facts.push("Prints its answer as JSON with `--json`.");
  if (command.interactive) facts.push("May ask questions on a terminal; `--no-input` never does.");
  if (command.longRunning) facts.push("Runs until you stop it.");
  lines.push("", facts.join(" "));
  if (command.exitCodes.length > 0) {
    lines.push("", "| Exit code | What it means |", "| --- | --- |");
    for (const exit of command.exitCodes) {
      lines.push(`| \`${exit.code}\` | ${cell(escapeMdx(`${exit.meaning}.`))} |`);
    }
  }
  if (command.examples.length > 0) lines.push("", "```sh", ...command.examples, "```");
  return lines.join("\n");
}

const groups = Object.entries(cli.groups).map(([key, title]) => {
  const commands = cli.commands.filter((command) => command.group === key);
  return [`## ${title}`, "", ...commands.map(commandSection).flatMap((s) => [s, ""])]
    .join("\n")
    .trimEnd();
});

const byNeed = (need) =>
  cli.commands
    .filter((command) => command.database === need)
    .map((command) => `\`graft ${command.id}\``)
    .join(", ");

const page = `---
# GENERATED FILE. Do not edit.
# Source: packages/cli/src/registry.ts and topics.ts, read through \`graft commands --json\`
# Regenerate: pnpm docs:cli
title: CLI reference
description: ${quote(`Every graft command, its arguments and flags, grouped by task. ${cli.commands.length} commands.`)}
section: Reference
order: 0
---

<p className="kicker">Every graft command, grouped by when you use it.</p>

Look up a command here. In a terminal, \`graft --help\` lists the commands and
\`graft <command> --help\` shows one command's usage and flags. To read graft's
output from a script or an agent, see [Script the CLI](/docs/cli).

This page is generated from the table the CLI's own help reads, so the two
always match. \`graft migrate\` and \`graft merge\` only report what they would
change until you pass \`--apply\`.

${groups.join("\n\n")}

## Exit codes

Every command exits with one of these, unless its entry above lists its own.

| Exit code | What it means |
| --- | --- |
${cli.exitCodes.map((exit) => `| \`${exit.code}\` | ${cell(escapeMdx(`${exit.meaning}.`))} |`).join("\n")}

## Environment variables

These change how the CLI behaves. Your project's own settings are on the
[Configuration](/docs/configuration) page.

| Variable | What it does |
| --- | --- |
${cli.environment.map((env) => `| \`${env.name}\` | ${cell(escapeMdx(`${env.summary}.`))} |`).join("\n")}

## Which commands need a database

Graft reads \`.env\` from the current folder or any folder above it.

- **Always need \`DATABASE_URL\`:** ${byNeed("always")}.
- **Need it on the Postgres engine only:** ${byNeed("postgres")}.
- **Use it when it is set:** ${byNeed("optional")}.
- **Never need it:** ${byNeed("never")}.
`;

/**
 * The README's command table, between its markers. Aligned the way the repo's
 * formatter aligns Markdown tables, so `pnpm format` leaves it alone.
 */
function alignedTable(header, rows) {
  const widths = header.map((_, i) => Math.max(...[header, ...rows].map((row) => row[i].length)));
  const line = (row) => `| ${row.map((text, i) => text.padEnd(widths[i])).join(" | ")} |`;
  return [line(header), `| ${widths.map((w) => "-".repeat(w)).join(" | ")} |`, ...rows.map(line)];
}

const table = [
  START,
  "",
  ...alignedTable(
    ["Command", "What it does"],
    cli.commands.map((command) => [`\`graft ${command.id}\``, cell(command.summary)]),
  ),
  "",
  END,
].join("\n");

const readme = readFileSync(README, "utf8");
const from = readme.indexOf(START);
const to = readme.indexOf(END);
if (from === -1 || to === -1) {
  console.error(`${README} has no ${START} … ${END} block for the command table.`);
  process.exit(1);
}
const nextReadme = readme.slice(0, from) + table + readme.slice(to + END.length);

const normalize = (text) => text.replace(/\r\n/g, "\n");
if (check) {
  let current = "";
  try {
    current = readFileSync(PAGE, "utf8");
  } catch {
    console.error(`Missing: ${PAGE}`);
  }
  const stale = [];
  if (normalize(current) !== normalize(page)) stale.push(PAGE);
  if (normalize(readme) !== normalize(nextReadme)) stale.push(README);
  if (stale.length > 0) {
    console.error("The CLI reference is stale: the command registry changed and these did not.");
    for (const file of stale) console.error(`  ${file}`);
    console.error("Run: pnpm build, then pnpm docs:cli");
    process.exit(1);
  }
  console.log(`CLI reference is current (${cli.commands.length} commands).`);
} else {
  writeFileSync(PAGE, page, "utf8");
  writeFileSync(README, nextReadme, "utf8");
  console.log(`Wrote ${PAGE} and the README table (${cli.commands.length} commands).`);
}
