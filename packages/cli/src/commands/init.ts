/**
 * graft init — scaffold a Graft project: schema as owned code, content as files,
 * and an llms.txt so the next agent that opens the directory knows the loop.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { GraftError } from "@usegraft/contracts";
import { barrelSource } from "@usegraft/registry";
import { CONFIG_FILENAMES } from "../config";

const CONFIG_TEMPLATE = `/**
 * The schema for this project — collections defined as owned code.
 * Agents: this is the single source of truth for what content exists.
 * Add fields here, then author documents in content/<collection>/<slug>.mdx.
 *
 * Primitives you add with \`graft add\` live under graft/ and are merged in via
 * the generated graft/index.ts barrel — you never edit the import below.
 */
import { defineCollection, field, mergePrimitives } from "@usegraft/core";
import * as primitives from "./graft";

export const pages = defineCollection({
  name: "pages",
  description: "Pages rendered by your site.",
  fields: {
    title: field.string({ description: "Page headline and <title>." }),
    tagline: field.string({ optional: true, description: "Short line under the headline." }),
  },
});

// Your own collections/functions + everything under graft/ (added via \`graft add\`).
// mergePrimitives throws CONFIG_INVALID on a duplicate key — never a silent override.
export const { collections, functions } = mergePrimitives([{ collections: { pages } }, primitives]);
`;

const HOME_TEMPLATE = `---
title: Hello, Graft
tagline: Content lives in git; Postgres is the index.
---

Edit this file, then run \`graft compile\` (or keep \`graft dev\` running) to
project it into the content index.
`;

const LLMS_TEMPLATE = `# Graft project — agent guide

Everything is code. Content lives in MDX files; git is authoritative; Postgres
is a derived index. If they disagree, git wins — recompile.

- Schema: graft.config.ts (defineCollection/field over Zod). The single source of truth.
- Documents: content/<collection>/<slug>.mdx — frontmatter must satisfy the collection schema.
- Slugs are kebab-case; a frontmatter \`slug:\` overrides the filename.
- Project into the index: \`graft compile\` (one-shot) or \`graft dev\` (watch mode).
  Both need DATABASE_URL in .env (any parent directory works).
- One project = one database. Never point DATABASE_URL at another project's
  index — compile refuses with INDEX_OWNERSHIP rather than purge its documents.
- Primitives: add owned building blocks with \`graft add <item>\` — they land under
  graft/ and wire in automatically (the generated graft/index.ts barrel; no config
  edit). Run \`graft add\` with no name to list what's available.
- Every Graft error carries a \`fix\` — do what it says, then retry.
- Ship changes as git commits; every projection records the git SHA it compiled from.
`;

const SCAFFOLD: Record<string, string> = {
  "graft.config.ts": CONFIG_TEMPLATE,
  // The generated barrel graft add regenerates; empty until the first `graft add`.
  [join("graft", "index.ts")]: barrelSource([]),
  [join("content", "pages", "home.mdx")]: HOME_TEMPLATE,
  "llms.txt": LLMS_TEMPLATE,
};

export interface InitResult {
  projectDir: string;
  /** Relative paths written (existing files are left untouched and not listed). */
  created: string[];
}

export function initCommand(options: { targetDir: string }): InitResult {
  const projectDir = resolve(options.targetDir);

  for (const name of CONFIG_FILENAMES) {
    if (existsSync(join(projectDir, name))) {
      throw new GraftError({
        code: "ALREADY_INITIALIZED",
        message: `${name} already exists in ${projectDir}.`,
        fix: "This is already a Graft project — evolve it by editing the existing graft.config.ts, or run `graft init <dir>` against an empty directory.",
      });
    }
  }

  const created: string[] = [];
  for (const [relPath, body] of Object.entries(SCAFFOLD)) {
    const absPath = join(projectDir, relPath);
    if (existsSync(absPath)) continue;
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, body, "utf8");
    created.push(relPath);
  }

  return { projectDir, created };
}
