/**
 * graft init — scaffold a Graft project: schema as owned code, content as files,
 * and an llms.txt so the next agent that opens the directory knows the loop.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { GraftError } from "@graft/contracts";
import { CONFIG_FILENAMES } from "../config";

const CONFIG_TEMPLATE = `/**
 * The schema for this project — collections defined as owned code.
 * Agents: this is the single source of truth for what content exists.
 * Add fields here, then author documents in content/<collection>/<slug>.mdx.
 */
import { defineCollection, field } from "@graft/core";

export const pages = defineCollection({
  name: "pages",
  description: "Pages rendered by your site.",
  fields: {
    title: field.string({ description: "Page headline and <title>." }),
    tagline: field.string({ optional: true, description: "Short line under the headline." }),
  },
});

export const collections = { pages };
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
- Every Graft error carries a \`fix\` — do what it says, then retry.
- Ship changes as git commits; every projection records the git SHA it compiled from.
`;

const SCAFFOLD: Record<string, string> = {
  "graft.config.ts": CONFIG_TEMPLATE,
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
