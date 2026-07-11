/**
 * The app's Graft handle — lazy so `astro build` never needs a database when
 * every page is server-rendered (the first request initializes the pool).
 * Server-only: import from .astro frontmatter and endpoints, never islands.
 */
import { createDb } from "@graft/db";
import { createGraft, type Graft } from "@graft/sdk-astro";
import { collections } from "../../graft.config";

let graft: Graft<typeof collections> | null = null;

export function getGraft(): Graft<typeof collections> {
  if (!graft) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "DATABASE_URL is not set. Put it in the repo-root .env (loaded by astro.config.mjs) or the environment.",
      );
    }
    graft = createGraft({ db: createDb(url).db, collections });
  }
  return graft;
}
