/** POST /api/mcp: MCP over Streamable HTTP. Needs the Postgres engine. */
import { resolve } from "node:path";
import { createActorResolver } from "@usegraft/auth";
import { createGraftMcpHandler } from "@usegraft/mcp";
import { graftHandler } from "@usegraft/sdk-nitro";
import * as graftConfig from "#graft/config";
import { defineEventHandler, useRuntimeConfig } from "nuxt/server";
import { optionalConfig, useGraftDatabase } from "./graft";
import { actorOptions, lazyHandler } from "./handler";

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
        actor: createActorResolver(actorOptions(useRuntimeConfig().graft)),
      }),
    ),
  ),
);
