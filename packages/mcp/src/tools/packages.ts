/**
 * list_packages — which @usegraft package to reach for.
 *
 * The rest of the tool surface answers questions about a project that already
 * exists: its collections, its functions, what failed. This one answers the
 * question that comes first and had no surface at all — "I am on Next.js, what
 * do I install?" Without it that answer depended on the agent having read the
 * docs.
 */
import { z } from "zod";
import { allPackages } from "../packages";
import { guarded } from "../tool-result";
import { READS } from "./annotations";
import { listPackagesOutput } from "./outputs";
import type { RegisterTools } from "./deps";

export const registerPackageTools: RegisterTools = (server, deps) => {
  void deps;

  server.registerTool(
    "list_packages",
    {
      title: "List Graft packages",
      outputSchema: listPackagesOutput,
      annotations: READS,
      description:
        "Which @usegraft/* package to install for a given framework or job: what each one is, when you need it, and which tier it requires. Filter by `framework` when the user is on a known one, or by `tier`. Use this before suggesting an install; use list_registry for copy-in primitives instead.",
      inputSchema: {
        framework: z
          .enum(["next", "astro", "sveltekit", "react-router", "tanstack-start", "react"])
          .optional()
          .describe("Only the adapter for this framework, plus the packages every project needs"),
        tier: z
          .enum(["static", "postgres"])
          .optional()
          .describe("Only packages usable on this tier"),
        includeIndirect: z
          .boolean()
          .optional()
          .describe("Include packages pulled in as dependencies rather than installed directly"),
      },
    },
    ({ framework, tier, includeIndirect }) =>
      guarded(() => {
        let packages = allPackages();

        if (!includeIndirect) packages = packages.filter((p) => p.direct);

        // A framework filter keeps the framework-agnostic packages: the answer
        // to "I am on Astro" is the adapter AND the cli and core every project
        // needs, not the adapter alone.
        if (framework) {
          packages = packages.filter((p) => p.framework === undefined || p.framework === framework);
        }

        // `either` satisfies both tiers; a static project must not be told to
        // install something that cannot work without Postgres.
        if (tier) packages = packages.filter((p) => p.tier === "either" || p.tier === tier);

        return { packages: packages.sort((a, b) => a.name.localeCompare(b.name)) };
      }),
  );
};
