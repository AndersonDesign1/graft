// The SvelteKit guide's client, on the static index.
import { openStaticIndex } from "@usegraft/db";
import { createGraft } from "@usegraft/sdk-sveltekit";
import { collections } from "../../../graft.config";

export const index = await openStaticIndex(".graft/index.db");
export const graft = createGraft({ index, collections });
