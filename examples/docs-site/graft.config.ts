/**
 * The schema for the Graft docs site — collections defined as owned code.
 * Agents: this is the single source of truth for what content exists.
 * Add fields here, then author documents in content/<collection>/<slug>.mdx.
 *
 * Primitives you add with `graft add` live under graft/ and are merged in via
 * the generated graft/index.ts barrel — you never edit the import below.
 */
import { defineCollection, defineFunction, field, mergePrimitives } from "@graft/core";
import * as primitives from "./graft";

/** Marketing/landing pages (/, /why). */
export const pages = defineCollection({
  name: "pages",
  description: "Top-level site pages rendered at / and /<slug>.",
  fields: {
    title: field.string({ description: "Page headline (h1) and <title>." }),
    tagline: field.string({ optional: true, description: "Short line under the headline." }),
    description: field.string({
      optional: true,
      description: "Meta description for search/social previews.",
    }),
  },
});

/** Documentation pages, grouped by section and ordered within it. */
export const docs = defineCollection({
  name: "docs",
  description: "Documentation pages rendered at /docs/<slug>, grouped by section.",
  fields: {
    title: field.string({ description: "Doc page title (h1, sidebar label, <title>)." }),
    description: field.string({ description: "One-line summary shown in listings and meta." }),
    section: field.string({
      description: 'Sidebar group, e.g. "Start here", "Reading content", "Deploy".',
    }),
    order: field.number({ optional: true, description: "Sort order within the section." }),
  },
});

/**
 * docStats — the docs site's own heartbeat: what the index currently serves.
 * Exists so the graftRoute mount (/api/fn/docStats) is exercised end-to-end.
 */
export const docStats = defineFunction({
  name: "docStats",
  kind: "query",
  description: "Lists live doc slugs by section on the current branch, from content_index.",
  returns: "{ branch: string; count: number; sections: Record<string, string[]> }",
  input: {},
  handler: async ({ db, branch }) => {
    const rows = await db.query.contentIndex.findMany({
      columns: { slug: true, data: true },
      where: (t, { and, eq }) =>
        and(eq(t.branchId, branch), eq(t.collection, "docs"), eq(t.deleted, false)),
      orderBy: (t, { asc }) => asc(t.slug),
    });
    const sections: Record<string, string[]> = {};
    for (const row of rows) {
      const section = String((row.data as { section?: string }).section ?? "Other");
      (sections[section] ??= []).push(row.slug);
    }
    return { branch, count: rows.length, sections };
  },
});

// Your own collections/functions + everything under graft/ (added via `graft add`).
// mergePrimitives throws CONFIG_INVALID on a duplicate key — never a silent override.
export const { collections, functions } = mergePrimitives([
  { collections: { pages, docs }, functions: { docStats } },
  primitives,
]);
