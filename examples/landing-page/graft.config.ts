/**
 * The schema for this site — collections and functions defined as owned code.
 * Agents: this is the single source of truth for what content exists.
 * Add fields here, then author documents in content/<collection>/*.mdx.
 * Functions are served at POST /api/fn/<name> (JSON object body).
 */
import { defineCollection, defineFunction, field } from "@graft/core";

export const pages = defineCollection({
  name: "pages",
  description: "Marketing pages rendered at / (home) and /<slug>.",
  fields: {
    title: field.string({ description: "Page headline (h1) and <title>." }),
    tagline: field.string({ optional: true, description: "Short line under the headline." }),
    order: field.number({ optional: true, description: "Nav sort order (ascending)." }),
    image: field.asset({
      optional: true,
      description: "Hero image above the body. Upload with `graft asset put <file> [key]`.",
    }),
  },
});

export const collections = { pages };

/**
 * pageStats — a zero-arg query demonstrating the typed function runtime:
 * standard context in (db, branch, actor, correlationId), JSON out.
 * Live operational data (mutations into Postgres) lands in the next unit.
 */
export const pageStats = defineFunction({
  name: "pageStats",
  kind: "query",
  description: "Lists the live page slugs on the current branch, straight from content_index.",
  returns: "{ branch: string; count: number; slugs: string[] }",
  input: {},
  handler: async ({ db, branch }) => {
    const rows = await db.query.contentIndex.findMany({
      columns: { slug: true },
      where: (t, { and, eq }) =>
        and(eq(t.branchId, branch), eq(t.collection, "pages"), eq(t.deleted, false)),
      orderBy: (t, { asc }) => asc(t.slug),
    });
    return { branch, count: rows.length, slugs: rows.map((r) => r.slug) };
  },
});

export const functions = { pageStats };
