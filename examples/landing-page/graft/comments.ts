/**
 * comments — a moderated-comments primitive (owned code; edit freely).
 *
 * A db-authoritative collection plus its functions: post (public), list
 * (public; approved only), moderate (approve/hide; scope-gated), and delete
 * (destructive; human-gated). Wired automatically via the graft/ barrel — live
 * on the next `graft compile`. See graft/comments.llms.txt for the flow.
 */
import {
  defineCollection,
  defineFunction,
  deleteRecord,
  field,
  insertRecord,
  listRecords,
  updateRecord,
} from "@usegraft/core";
import { requireModerator } from "./scoped-access";

export const comments = defineCollection({
  name: "comments",
  authority: "db-authoritative",
  description: "Visitor comments, held for moderation until approved.",
  fields: {
    pageSlug: field.string({
      maxLength: 200,
      description: "Slug of the page the comment belongs to.",
    }),
    author: field.string({ maxLength: 80, description: "Commenter's display name." }),
    body: field.text({ maxLength: 4000, description: "The comment text." }),
    approved: field.boolean({ description: "Only approved comments list publicly." }),
  },
});

/** Public: anyone may post; the comment is held unapproved until moderated. */
export const postComment = defineFunction({
  name: "postComment",
  kind: "mutation",
  public: true,
  rateLimit: { limit: 5, windowSeconds: 60 },
  description:
    "Post a comment (public; held unapproved until a moderator approves it). 5/min per caller.",
  returns: "{ id: string; receivedAt: string }",
  input: {
    pageSlug: field.string({ maxLength: 200, description: "Page the comment is on." }),
    author: field.string({ maxLength: 80, description: "Display name." }),
    body: field.text({ maxLength: 4000, description: "The comment text." }),
  },
  handler: async (ctx) => {
    const record = await insertRecord(ctx, comments, { ...ctx.input, approved: false });
    return { id: record.id, receivedAt: record.createdAt.toISOString() };
  },
});

/** Public: only approved comments for the page, newest first. */
export const listComments = defineFunction({
  name: "listComments",
  kind: "query",
  description: "List approved comments for a page, newest first.",
  returns: "{ comments: { id: string; author: string; body: string; receivedAt: string }[] }",
  rateLimit: { limit: 60, windowSeconds: 60 },
  input: {
    pageSlug: field.string({ maxLength: 200, description: "Page to list comments for." }),
    limit: field.number({
      optional: true,
      int: true,
      min: 1,
      max: 100,
      description: "Max comments to return (default 100).",
    }),
  },
  handler: async (ctx) => {
    // Both predicates run in SQL. Filtering after the row cap meant unapproved
    // comments consumed the window, so posting enough of them hid every
    // approved comment on every page — silently, with no error.
    const records = await listRecords(ctx, comments, {
      limit: ctx.input.limit ?? 100,
      match: { approved: true, pageSlug: ctx.input.pageSlug },
    });
    return {
      comments: records.map((r) => ({
        id: r.id,
        author: r.data.author,
        body: r.data.body,
        receivedAt: r.createdAt.toISOString(),
      })),
    };
  },
});

/** Scope-gated: approve or hide a comment. Needs the content:moderate scope. */
export const moderateComment = defineFunction({
  name: "moderateComment",
  kind: "mutation",
  description: "Approve or hide a comment. Requires the content:moderate scope.",
  returns: "{ id: string; approved: boolean }",
  input: {
    id: field.string({ description: "The comment row id (uuid)." }),
    approved: field.boolean({ description: "true to approve (publish), false to hide." }),
  },
  access: requireModerator,
  handler: async (ctx) => {
    const record = await updateRecord(ctx, comments, ctx.input.id, {
      approved: ctx.input.approved,
    });
    return { id: record.id, approved: record.data.approved };
  },
});

/** Destructive + scope-gated: permanently delete a comment (human-gated). */
export const deleteComment = defineFunction({
  name: "deleteComment",
  kind: "mutation",
  destructive: true,
  description:
    "Permanently delete a comment. Destructive: requires human approval (graft approve) and the content:moderate scope.",
  returns: "{ deleted: { id: string } }",
  input: { id: field.string({ description: "The comment row id (uuid)." }) },
  access: requireModerator,
  handler: async (ctx) => {
    const removed = await deleteRecord(ctx, comments, ctx.input.id);
    return { deleted: { id: removed.id } };
  },
});

export const collections = { comments };
export const functions = { postComment, listComments, moderateComment, deleteComment };
