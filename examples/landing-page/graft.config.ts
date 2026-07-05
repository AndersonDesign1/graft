/**
 * The schema for this site — collections and functions defined as owned code.
 * Agents: this is the single source of truth for what content exists.
 * Add fields here, then author documents in content/<collection>/*.mdx.
 * Functions are served at POST /api/fn/<name> (JSON object body).
 */
import { defineCollection, defineFunction, field, insertRecord, listRecords } from "@graft/core";

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

/**
 * submissions — operational data (db-authoritative): rows live in Postgres,
 * written only through the functions below. There is no content/submissions/
 * folder; files for this collection are an AUTHORITY_MISMATCH.
 */
export const submissions = defineCollection({
  name: "submissions",
  authority: "db-authoritative",
  description: "Contact-form submissions. Write via submitContact; read via listSubmissions.",
  fields: {
    email: field.string({ description: "Sender address." }),
    message: field.text({ optional: true, description: "What they wrote." }),
  },
});

export const collections = { pages, submissions };

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

/** Public mutation: the contact form posts here. Input reuses the collection's fields. */
export const submitContact = defineFunction({
  name: "submitContact",
  kind: "mutation",
  description: "Stores a contact-form submission (public; anonymous callers allowed).",
  returns: "{ id: string; receivedAt: string }",
  input: submissions.fields,
  handler: async (ctx) => {
    const record = await insertRecord(ctx, submissions, ctx.input);
    return { id: record.id, receivedAt: record.createdAt.toISOString() };
  },
});

/** Gated query: reading submissions requires a non-anonymous actor (bearer token). */
export const listSubmissions = defineFunction({
  name: "listSubmissions",
  kind: "query",
  description:
    "Lists recent submissions, newest first. Requires authentication — send Authorization: Bearer <GRAFT_FUNCTIONS_TOKEN>.",
  returns: "{ submissions: { id, email, message?, receivedAt }[] }",
  input: { limit: field.number({ optional: true, description: "Max rows (default 50)." }) },
  access: (ctx) => ctx.actor.kind !== "anonymous",
  handler: async (ctx) => {
    const records = await listRecords(ctx, submissions, { limit: ctx.input.limit });
    return {
      submissions: records.map((r) => ({
        id: r.id,
        email: r.data.email,
        message: r.data.message,
        receivedAt: r.createdAt.toISOString(),
      })),
    };
  },
});

export const functions = { pageStats, submitContact, listSubmissions };
