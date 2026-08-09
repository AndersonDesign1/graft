/**
 * The app's Graft handle — lazy so `next build` never needs a database
 * (all pages are dynamic; the first request initializes the connection).
 */
import { createDb } from "@usegraft/db";
import { createGraft, type Graft } from "@usegraft/sdk-next";
import { collections } from "@/graft.config";

let graft: Graft<typeof collections> | null = null;

export function getGraft(): Graft<typeof collections> {
  if (!graft) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "DATABASE_URL is not set. Put it in the repo-root .env (loaded by next.config.ts) or the environment.",
      );
    }
    graft = createGraft({ db: createDb(url).db, collections });
  }
  return graft;
}
