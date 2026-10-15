/**
 * Drafts on a content store that keeps them: the agent's side of Studio's
 * Publish button. Registered only when the mount writes through such a store
 * (GitHub, or the database in a database-sourced project), since with files
 * in a checkout the headless equivalent is git itself.
 *
 * Publishing defaults to a review: a pull request on GitHub, a request in
 * Studio's inbox in the database. Moving the production branch
 * directly takes the `content:publish` scope, the agent counterpart of
 * Studio's `studio:publish`: an agent drafts freely, and a human, or a token
 * deliberately trusted to, puts it live.
 */
import { notifyContentChange } from "@usegraft/compiler";
import { z } from "zod";
import { DESTROYS, READS, WRITES } from "./annotations";
import { ContentRefresh } from "./outputs";
import type { RegisterTools } from "./deps";

const Review = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  number: z.number().optional(),
  url: z.string().optional(),
  paths: z.array(z.string()).optional(),
  requestedBy: z.string().optional(),
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
  /** Database-sourced projects: what the live index did. The site needs no rebuild. */
  changes: z
    .object({
      added: z.array(z.string()),
      changed: z.array(z.string()),
      removed: z.array(z.string()),
      unchanged: z.number(),
    })
    .optional(),
  refresh: ContentRefresh.optional(),
  /** Why a direct publish went to review: the site's rule for deletions, some collections or large changes. */
  reviewReasons: z.array(z.string()).optional(),
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
        "Unpublished changes (documents written with write_content or delete_content since the last publish) and open review requests. On GitHub these are this connection's own; in a database-sourced project there is one shared draft per document, so they include everyone's. Each change says whether it is added, modified or deleted, and whether the published version changed since the draft began (conflict: true).",
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
        'Publish drafts by path (from list_drafts). Without the "content:publish" scope this asks for review: a pull request on GitHub, or a request a person approves in Studio when content is in the database. With it, and a site that publishes directly, it goes live: a commit to the production branch that the site redeploys from, or, when content is in the database, straight onto the live site with no rebuild (the result carries `changes`). A path the published version also changed is refused with CONTENT_CONFLICT; resend with resolve: { "<path>": "mine" | "theirs" }.',
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
        const result = await drafts.publish({
          actor: deps.storeActor(),
          paths,
          ...(message ? { message } : {}),
          ...(resolve ? { resolve } : {}),
          mode: direct ? "direct" : "review",
        });
        // A commit to the production branch is a publish the site rebuilds
        // from: call the deploy hooks, as a database store does on its own.
        if (!result.changes && result.mode === "direct" && result.commit) {
          try {
            await deps.options.onPublished?.({ branch: deps.branchId, paths: result.published });
          } catch {
            // The commit landed; a hook that failed is shown in Settings.
          }
        }
        // Live already (the database store updated the index): tell the app
        // now, since no rebuild is coming to do it.
        if (!result.changes) return result;
        const refresh = await notifyContentChange(deps.options.onContentChange, {
          branch: deps.branchId,
          gitSha: null,
          changes: result.changes,
        });
        return refresh ? { ...result, refresh } : result;
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
