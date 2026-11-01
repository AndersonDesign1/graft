/**
 * GET /api/content/v1/*: the read-only content API, over the project's engine.
 * The page composables read through it, in-process during server rendering.
 *
 * No rate limit: during server rendering every page view reaches this route
 * from the server itself, with no socket to tell callers apart, so one shared
 * bucket would throttle the site. Put a limiter in front of a public deploy.
 */
import { createContentApiHandler } from "@usegraft/content-api";
import { graftHandler } from "@usegraft/sdk-nitro";
import * as graftConfig from "#graft/config";
import { defineEventHandler } from "nuxt/server";
import { BRANCH, useGraftReader } from "./graft";
import { lazyHandler } from "./handler";

export default defineEventHandler(
  graftHandler(
    lazyHandler(async () =>
      createContentApiHandler({
        collections: Object.keys(graftConfig.collections),
        branch: BRANCH,
        index: await useGraftReader(),
      }),
    ),
  ),
);
