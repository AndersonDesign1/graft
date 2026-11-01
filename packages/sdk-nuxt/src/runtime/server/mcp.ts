/** POST /api/mcp: MCP over Streamable HTTP. Needs the Postgres engine. */
import { resolve } from "node:path";
import { createActorResolver } from "@usegraft/auth";
import { createGraftMcpHandler } from "@usegraft/mcp";
import { graftHandler } from "@usegraft/sdk-nitro";
import * as graftConfig from "#graft/config";
import { defineEventHandler, useRuntimeConfig } from "nuxt/server";
import { optionalConfig, useGraftDatabase } from "./graft";
import { actorOptions } from "./actor";
import { lazyHandler, RATE_LIMIT } from "./handler";
import { approvalPolicyFor, mdxTrustFor } from "./settings";

export default defineEventHandler(
  graftHandler(
    lazyHandler(async () =>
      createGraftMcpHandler({
        // The server runs from the project root, in development and with
        // `node .output/server/index.mjs`, as graft.config.ts's own paths assume.
        contentDir: resolve(process.cwd(), optionalConfig.contentDir ?? "content"),
        db: await useGraftDatabase("/api/mcp"),
        collections: graftConfig.collections,
        functions: optionalConfig.functions ?? {},
        mdxTrust: mdxTrustFor(optionalConfig.mdxTrust),
        // MCP takes "none" or "human" only: "unattended" is for callers with no
        // human behind them, and an MCP caller is an agent. A project that
        // gates every mutation gets the same gate on run_function.
        approvalPolicy:
          approvalPolicyFor(optionalConfig.approvalPolicy) === "human" ? "human" : "none",
        actor: createActorResolver(actorOptions(useRuntimeConfig().graft)),
        rateLimit: RATE_LIMIT,
      }),
    ),
  ),
);
