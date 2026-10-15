/**
 * sync_status: how the files in this checkout compare with what is published,
 * in a project whose content is in the database. Registered only there, and
 * only on a server that has the checkout (local stdio), so a coding agent can
 * ask before it edits files that may be behind.
 */
import { syncStatus } from "@usegraft/compiler";
import { z } from "zod";
import { READS } from "./annotations";
import type { RegisterTools } from "./deps";
import { guarded } from "../tool-result";

const syncStatusOutput = {
  behind: z.array(z.string()),
  ahead: z.array(z.string()),
  conflicts: z.array(z.string()),
  inSync: z.number(),
  next: z.string(),
};

export const registerSyncTools: RegisterTools = (server, deps) => {
  const stateFile = deps.options.syncStateFile;
  if (deps.options.source !== "database" || !stateFile) return;

  server.registerTool(
    "sync_status",
    {
      title: "Compare files with what is published",
      outputSchema: syncStatusOutput,
      annotations: READS,
      description:
        "This project's content is in the database, and the files under the content directory are a checkout. Lists documents whose files are behind what is published (run `graft pull` before editing them), ahead of it (changed here; `graft push` publishes them), or changed on both sides (conflicts). Call it before editing content files directly; or skip the files and use write_content, which writes to the database.",
      inputSchema: {},
    },
    () =>
      guarded(async () => {
        const entries = await syncStatus({
          db: deps.requireDb("sync_status", "Run graft pull in the project instead."),
          contentDir: deps.contentDir,
          stateFile,
          branchId: deps.branchId,
        });
        const pick = (state: string) => entries.filter((e) => e.state === state).map((e) => e.path);
        const behind = pick("behind");
        const ahead = pick("ahead");
        const conflicts = pick("conflict");
        const next =
          conflicts.length > 0
            ? "Resolve the conflicts: graft pull keeps your files and lists them; bring each change into the published version, then graft push."
            : behind.length > 0
              ? "Run graft pull before editing these files."
              : ahead.length > 0
                ? "Run graft push to publish the files you changed."
                : "The files match what is published.";
        return {
          behind,
          ahead,
          conflicts,
          inSync: entries.length - behind.length - ahead.length - conflicts.length,
          next,
        };
      }),
  );
};
