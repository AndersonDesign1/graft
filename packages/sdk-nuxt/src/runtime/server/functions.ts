/** POST /api/fn/:name: the project's typed functions. Needs the Postgres engine. */
import { createActorResolver } from "@usegraft/auth";
import { createFunctionsHandler } from "@usegraft/core";
import { graftHandler } from "@usegraft/sdk-nitro";
import { defineEventHandler, useRuntimeConfig } from "nuxt/server";
import { optionalConfig, useGraftDatabase } from "./graft";
import { actorOptions, lazyHandler } from "./handler";

export default defineEventHandler(
  graftHandler(
    lazyHandler(async () =>
      createFunctionsHandler({
        db: await useGraftDatabase("/api/fn"),
        functions: optionalConfig.functions ?? {},
        actor: createActorResolver(actorOptions(useRuntimeConfig().graft)),
      }),
    ),
  ),
);
