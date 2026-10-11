/**
 * Drafts on a remote content store: the agent's side of a hosted Studio's
 * Publish button. Registered only when the mount writes through a store that
 * keeps drafts (GitHub), since locally the headless equivalent is git itself.
 *
 * Publishing defaults to a pull request. Moving the production branch
 * directly takes the `content:publish` scope, the agent counterpart of
 * Studio's `studio:publish`: an agent drafts freely, and a human, or a token
 * deliberately trusted to, puts it live.
 */
import { z } from "zod";
import { DESTROYS, READS, WRITES } from "./annotations";
import type { RegisterTools } from "./deps";

const Review = z.object({
  number: z.number(),
  url: z.string(),
  title: z.string(),
  createdAt: z.string(),
});

const listDraftsOutput = {
  repository: z.string().nullable(),
  branch: z.string().nullable(),
  changes: z.array(
    z.object({
      path: z.string(),
      kind: z.enum(["added", "modified", "deleted"]),
      version: z.string().nullable(),
      conflict: z.boolean(),
    }),
  ),
  reviews: z.array(Review),
};

const publishDraftsOutput = {
  mode: z.enum(["direct", "review"]),
  commit: z.object({ sha: z.string(), url: z.string().optional() }).nullable(),
  published: z.array(z.string()),
  tookTheirs: z.array(z.string()),
  review: Review.optional(),
};

const discardDraftsOutput = { discarded: z.array(z.string()) };
import { guarded } from "../tool-result";

export const registerDraftTools: RegisterTools = (server, deps) => {
  const store = deps.remoteStore;
  const drafts = store?.drafts;
  if (!store || !drafts) return;

  const canPublishDirectly = (): boolean => {
    const actor = deps.options.connectionActor;
    if (actor === undefined) return deps.options.actor === undefined;
    return (actor.scopes ?? []).includes("content:publish");
  };

  server.registerTool(
    "list_drafts",
    {
      title: "List unpublished drafts",
      outputSchema: listDraftsOutput,
      annotations: READS,
      description:
        "This connection's unpublished changes (documents written with write_content or delete_content since the last publish) and its open review requests. Each change says whether it is added, modified or deleted, and whether the published version changed since the draft began (conflict: true).",
      inputSchema: {},
    },
    () =>
      guarded(async () => {
        const actor = deps.storeActor();
        const [changes, reviews] = await Promise.all([
          drafts.changes(actor),
          drafts.reviews(actor),
        ]);
        return {
          repository: store.info().repository ?? null,
          branch: store.info().branch ?? null,
          changes,
          reviews,
        };
      }),
  );

  server.registerTool(
    "publish_drafts",
    {
      title: "Publish drafts",
      outputSchema: publishDraftsOutput,
      annotations: WRITES,
      description:
        'Publish drafts by path (from list_drafts). Opens a pull request for a human to merge, unless this credential carries the "content:publish" scope and the site publishes directly, in which case it commits to the production branch and the site redeploys. A path the published version also changed is refused with CONTENT_CONFLICT; resend with resolve: { "<path>": "mine" | "theirs" }.',
      inputSchema: {
        paths: z.array(z.string()).min(1).describe("Content paths, e.g. products/blue-shirt.mdx"),
        message: z.string().optional().describe("Commit or pull request title"),
        resolve: z
          .record(z.string(), z.enum(["mine", "theirs"]))
          .optional()
          .describe("Per-path conflict resolution from an earlier CONTENT_CONFLICT"),
      },
    },
    ({ paths, message, resolve }) =>
      guarded(async () => {
        deps.requireScope("publish_drafts", "content:write");
        const direct = canPublishDirectly() && store.info().publishMode !== "review";
        return drafts.publish({
          actor: deps.storeActor(),
          paths,
          ...(message ? { message } : {}),
          ...(resolve ? { resolve } : {}),
          mode: direct ? "direct" : "review",
        });
      }),
  );

  server.registerTool(
    "discard_drafts",
    {
      title: "Discard drafts",
      outputSchema: discardDraftsOutput,
      annotations: DESTROYS,
      description:
        "Throw away this connection's drafts for the given paths. The published versions are untouched; only unpublished edits are lost.",
      inputSchema: {
        paths: z.array(z.string()).min(1).describe("Content paths from list_drafts"),
      },
    },
    ({ paths }) =>
      guarded(async () => {
        deps.requireScope("discard_drafts", "content:write");
        await drafts.discard(deps.storeActor(), paths);
        return { discarded: paths };
      }),
  );
};
