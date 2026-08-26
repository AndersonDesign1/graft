/**
 * The schema for this site — collections and functions defined as owned code.
 * Agents: this is the single source of truth for what content exists.
 * Add fields here, then author documents in content/<collection>/*.mdx.
 * Functions are served at POST /api/fn/<name> (JSON object body).
 *
 * Primitives from `graft add` live under graft/ and merge via the barrel.
 * Field helpers (seo, faq) are composed into collections below.
 */
import { requireScopes } from "@usegraft/auth";
import {
  defineCollection,
  defineFunction,
  deleteRecord,
  field,
  insertRecord,
  listRecords,
  mergePrimitives,
  searchRecords,
} from "@usegraft/core";
import * as primitives from "./graft";
import { faqFields } from "./graft/fields/faq";
import { seoFields } from "./graft/fields/seo";

export const pages = defineCollection({
  name: "pages",
  description: "Marketing pages rendered at / (home) and /<slug>.",
  fields: {
    title: field.string({ description: "Page headline (h1) and <title>." }),
    // Added after launch — migrations/0001-pages-description.ts backfilled it.
    description: field.string({ description: "Meta description for search/social previews." }),
    tagline: field.string({ optional: true, description: "Short line under the headline." }),
    order: field.number({ optional: true, description: "Nav sort order (ascending)." }),
    image: field.asset({
      optional: true,
      description: "Hero image above the body. Upload with `graft asset put <file> [key]`.",
    }),
    ...seoFields,
    ...faqFields,
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
    // Bounded: this is an anonymous public form writing into an unbounded jsonb
    // column, so an unbounded string is a storage-exhaustion vector.
    email: field.string({
      maxLength: 320,
      pattern: /^[^@\s]+@[^@\s]+\.[^@\s]+$/,
      description: "Sender address.",
    }),
    message: field.text({ maxLength: 4000, optional: true, description: "What they wrote." }),
  },
});

/**
 * pageStats — a zero-arg query demonstrating the typed function runtime:
 * standard context in (db, branch, actor, correlationId), JSON out.
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

/**
 * Public mutation: the contact form posts here. Mutations reject anonymous
 * callers by default — `public: true` is the explicit, greppable opt-out.
 */
export const submitContact = defineFunction({
  name: "submitContact",
  kind: "mutation",
  public: true,
  rateLimit: { limit: 5, windowSeconds: 60 },
  description:
    "Stores a contact-form submission (public; anonymous callers allowed; 5/min per caller).",
  returns: "{ id: string; receivedAt: string }",
  input: submissions.fields,
  handler: async (ctx) => {
    const record = await insertRecord(ctx, submissions, ctx.input);
    return { id: record.id, receivedAt: record.createdAt.toISOString() };
  },
});

/** Scope-gated query: the caller's token must carry the submissions:read scope. */
export const listSubmissions = defineFunction({
  name: "listSubmissions",
  kind: "query",
  description:
    "Lists recent submissions, newest first. Requires a token with the submissions:read scope — mint one at GET /api/auth/token after signing in, or use GRAFT_DEV_TOKEN locally.",
  returns: "{ submissions: { id, email, message?, receivedAt }[] }",
  input: { limit: field.number({ optional: true, description: "Max rows (default 50)." }) },
  access: requireScopes("submissions:read"),
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

/** Full-text search over submissions — same scope gate as listSubmissions. */
export const searchSubmissions = defineFunction({
  name: "searchSubmissions",
  kind: "query",
  description:
    'Full-text search over submissions (websearch syntax: words, "quoted phrases", `or`, -exclusions), best match first. Requires the submissions:read scope.',
  returns: "{ submissions: { id, email, message?, rank, receivedAt }[] }",
  input: {
    query: field.string({ description: 'What to find, e.g. refund "free tier".' }),
    limit: field.number({ optional: true, description: "Max hits (default 20)." }),
  },
  access: requireScopes("submissions:read"),
  handler: async (ctx) => {
    const hits = await searchRecords(ctx, submissions, ctx.input.query, {
      limit: ctx.input.limit,
    });
    return {
      submissions: hits.map((h) => ({
        id: h.id,
        email: h.data.email,
        message: h.data.message,
        rank: h.rank,
        receivedAt: h.createdAt.toISOString(),
      })),
    };
  },
});

/**
 * Destructive mutation: hard-deletes a row, so it is human-gated — calling it
 * files an approval (403 with the id), a human runs `graft approve <id>`, and
 * the caller retries with `x-graft-approval: <id>`. Requires the
 * submissions:admin scope on top of the gate.
 */
export const deleteSubmission = defineFunction({
  name: "deleteSubmission",
  kind: "mutation",
  destructive: true,
  description:
    "Permanently deletes one submission by id. Destructive: requires human approval (graft approve) and the submissions:admin scope.",
  returns: "{ deleted: { id: string; email: string } }",
  input: { id: field.string({ description: "The submission row id (uuid)." }) },
  access: requireScopes("submissions:admin"),
  handler: async (ctx) => {
    const removed = await deleteRecord(ctx, submissions, ctx.input.id);
    return { deleted: { id: removed.id, email: removed.data.email } };
  },
});

// The site's own collections + functions, plus any primitives added via
// `graft add` (they live under graft/ and arrive through the barrel import
// above). mergePrimitives rejects a duplicate key with CONFIG_INVALID.
export const { collections, functions } = mergePrimitives([
  {
    collections: { pages, submissions },
    functions: { pageStats, submitContact, listSubmissions, searchSubmissions, deleteSubmission },
  },
  primitives,
]);
