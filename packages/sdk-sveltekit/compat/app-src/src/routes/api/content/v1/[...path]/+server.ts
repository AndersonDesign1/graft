// A real Graft handler mounted with graftRoute: the read-only content API.
import { createContentApiHandler } from "@usegraft/content-api";
import { graftRoute } from "@usegraft/sdk-sveltekit";
import { collections } from "../../../../../../graft.config";
import { index } from "#lib/server/graft.ts";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = graftRoute(
  createContentApiHandler({ collections: Object.keys(collections), branch: "main", index }),
);
