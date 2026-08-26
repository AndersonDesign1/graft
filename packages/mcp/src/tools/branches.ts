/**
 * Branch and compilation history — the copy-on-write preview surface.
 *
 * Postgres-tier: a static project has no branches, so these teach the upgrade.
 */
import { listBranches, listCompilations } from "@usegraft/db";
import { z } from "zod";
import { guarded } from "../tool-result";
import type { RegisterTools } from "./deps";

export const registerBranchTools: RegisterTools = (server, deps) => {
  const { branchId, requireDb } = deps;

  server.registerTool(
    "list_branches",
    {
      title: "List branches",
      description:
        "List registered content branches (name, parent, backend, status). Same data as GET /api/studio/v1/branches and `graft branch`.",
      inputSchema: {},
    },
    () =>
      guarded(async () => ({
        branches: (
          await listBranches(
            requireDb(
              "list_branches",
              "Copy-on-write preview branches are a database feature; in a static project a branch is simply a git branch, and each checkout compiles its own artifact.",
            ),
          )
        ).map((row) => ({
          name: row.name,
          parent: row.parent,
          backend: row.backend,
          status: row.status,
          createdAt: row.createdAt.toISOString(),
          endpointHost: row.endpointHost,
        })),
      })),
  );

  server.registerTool(
    "list_compilations",
    {
      title: "List compilations",
      description:
        "Recent content projection trail rows (git SHA, added/changed/removed counts), newest first. Same data as GET /api/studio/v1/compilations and `graft compilations`.",
      inputSchema: {
        branch: z.string().optional().describe("Restrict to one branch id (default: all branches)"),
        limit: z.number().optional().describe("Max rows, newest first (default 20, max 100)"),
      },
    },
    ({ branch, limit }) =>
      guarded(async () => ({
        compilations: (
          await listCompilations(
            requireDb(
              "list_compilations",
              "The Postgres index keeps the full projection trail; a static artifact carries only the runs that built it.",
            ),
            {
              branchId: branch,
              limit,
            },
          )
        ).map((row) => ({
          id: row.id,
          branchId: row.branchId,
          gitSha: row.gitSha,
          docCount: row.docCount,
          added: row.added,
          changed: row.changed,
          removed: row.removed,
          createdAt: row.createdAt.toISOString(),
        })),
      })),
  );
};
