/**
 * The error reference is generated, not written.
 *
 * `@usegraft/mcp` already ships ERROR_KNOWLEDGE: one entry per ErrorCode with
 * its meaning, its typical causes, and how to recover. A test in
 * packages/mcp/src/server.test.ts asserts that registry stays in lockstep with
 * ErrorCodes, so the knowledge is already true and already guarded. Writing the
 * same 42 explanations again by hand would create a second copy that drifts,
 * and the drift would be invisible: prose does not fail a build.
 *
 * So the docs page is derived from the registry, and CI asserts regenerating it
 * changes nothing — the same argument, and the same mechanic, as
 * check-registry-drift.mjs.
 *
 *   node scripts/gen-error-docs.mjs           # write the page
 *   node scripts/gen-error-docs.mjs --check   # fail if it is stale
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const OUT = resolve(root, "examples/docs-site/content/docs/errors.mdx");
const SOURCE = resolve(root, "packages/mcp/dist/index.js");

const check = process.argv.includes("--check");

/** Import from the built package: the registry is a published export. */
let ERROR_KNOWLEDGE;
try {
  ({ ERROR_KNOWLEDGE } = await import(pathToFileURL(SOURCE).href));
} catch (error) {
  console.error(`Could not load ERROR_KNOWLEDGE from ${SOURCE}`);
  console.error("Run `pnpm build` first: this reads the built @usegraft/mcp.");
  console.error(String(error));
  process.exit(1);
}

if (!ERROR_KNOWLEDGE) {
  console.error("@usegraft/mcp does not export ERROR_KNOWLEDGE.");
  console.error("If it was renamed, update this script and the docs page together.");
  process.exit(1);
}

/** YAML-safe: the frontmatter strings are ours, but meanings come from code. */
const quote = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/**
 * These strings were written to be read in a terminal, so they contain
 * characters MDX parses as syntax: `<contentDir>/<collection>/<slug>.mdx` is
 * three unclosed JSX elements, and `graft.config.{ts,js}` is a JSX expression
 * that throws. Escape `<` and `{` everywhere except inside an inline code
 * span, where MDX already treats them as literal text.
 *
 * Walk the string once. A regex split-and-replace is what CodeQL flags as
 * incomplete sanitisation (`js/incomplete-sanitization`) — backslash-escaping
 * `<`/`{` via `replace` looks like a broken HTML escaper. A scan does the
 * same job and does not leave a sanitiser for the analyser to distrust.
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

const codes = Object.keys(ERROR_KNOWLEDGE).sort();

const body = codes
  .map((code) => {
    const { meaning, typicalCauses, howToRecover } = ERROR_KNOWLEDGE[code];
    const causes = typicalCauses.map((c) => `- ${escapeMdx(c)}`).join("\n");
    return [
      `### ${code}`,
      "",
      escapeMdx(meaning),
      "",
      "**Usually because**",
      "",
      causes,
      "",
      "**How to recover**",
      "",
      escapeMdx(howToRecover),
    ].join("\n");
  })
  .join("\n\n");

// The "do not edit" banner lives in the frontmatter, as YAML comments.
//
// It used to be an MDX comment, `{/* … */}`, which is a JSX expression holding
// a JavaScript comment — and @usegraft/mdx-safety refuses executable MDX, so
// this page failed `graft compile` and never entered the index. The whole
// error reference was missing from docs search, and because the compile aborts
// on the first offender, no other doc could be reindexed either.
//
// MDX 3 has no HTML comment to fall back on (`<!--` is a parse error), so the
// frontmatter is the only place left that is both invisible to readers and
// inert. gray-matter drops comments from the parsed data and composeDocument
// preserves the block verbatim, so they survive a Studio save.
const page = `---
# GENERATED FILE. Do not edit.
# Source: ERROR_KNOWLEDGE in packages/mcp/src/explain.ts
# Regenerate: node scripts/gen-error-docs.mjs
title: Error reference
description: ${quote(`Every Graft error code, what it means, and how to recover. ${codes.length} codes.`)}
section: Reference
order: 4
---

Every error Graft throws across a package boundary is a \`GraftError\`. It carries
a \`code\` from this list, a \`message\` saying what happened, and a \`fix\` naming
the next action. The \`fix\` is specific to the one failure. This page is the
general lesson behind the code.

Agents get the same content without leaving the tool surface: the
\`explain_error\` MCP tool returns these fields for any code.

There are ${codes.length} codes.

## Codes

${body}
`;

if (check) {
  let current = "";
  try {
    current = readFileSync(OUT, "utf8");
  } catch {
    console.error(`Missing: ${OUT}`);
    console.error("Run: node scripts/gen-error-docs.mjs");
    process.exit(1);
  }
  // Normalize line endings: git may check out CRLF on Windows.
  if (current.replace(/\r\n/g, "\n") !== page.replace(/\r\n/g, "\n")) {
    console.error("The error reference is stale.");
    console.error("ERROR_KNOWLEDGE changed and the docs page did not.");
    console.error("Run: node scripts/gen-error-docs.mjs");
    process.exit(1);
  }
  console.log(`Error reference is current (${codes.length} codes).`);
} else {
  writeFileSync(OUT, page, "utf8");
  console.log(`Wrote ${OUT} (${codes.length} codes).`);
}
