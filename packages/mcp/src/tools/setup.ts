/**
 * setup_status: where this project's setup stands, the same checklist
 * `graft doctor` prints, with the one thing to do next. A coding agent helping
 * someone set up a site calls it to know what to do, and what to say.
 * Registered on a server that has the project folder (local stdio).
 */
import { setupStatus } from "@usegraft/compiler";
import { z } from "zod";
import { READS } from "./annotations";
import type { RegisterTools } from "./deps";
import { guarded } from "../tool-result";

const setupStatusOutput = {
  ready: z.boolean(),
  checks: z.array(
    z.object({
      id: z.string(),
      state: z.enum(["pass", "warn", "fail"]),
      title: z.string(),
      detail: z.string(),
      fix: z.string().optional(),
    }),
  ),
  next: z.string().nullable(),
};

export const registerSetupTools: RegisterTools = (server, deps) => {
  const projectDir = deps.options.projectDir;
  if (!projectDir) return;

  server.registerTool(
    "setup_status",
    {
      title: "Check the project's setup",
      outputSchema: setupStatusOutput,
      annotations: READS,
      description:
        "Where this project's setup stands: the database and its Postgres version, the schema, a free database waiting to be claimed, content, the compiled index, and Studio sign-in. Each check has a state (pass, warn, fail), what was found, and the fix. `next` is the one thing to do now. Call it first when helping someone set up or deploy a site, and explain each step in plain words.",
      inputSchema: {},
    },
    () =>
      guarded(() =>
        setupStatus({
          projectDir,
          contentDir: deps.contentDir,
          index: deps.options.db ? "postgres" : "static",
          source: deps.options.source ?? "git",
          ...(deps.options.staticIndexPath
            ? { staticIndexPath: deps.options.staticIndexPath }
            : {}),
          ...(deps.options.db ? { db: deps.options.db } : {}),
        }),
      ),
  );
};
