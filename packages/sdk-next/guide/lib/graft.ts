import { createDb } from "@usegraft/db";
import { createGraft } from "@usegraft/sdk-next";
import { collections } from "@/graft.config";

export const { db } = createDb(process.env.DATABASE_URL!);
export const graft = createGraft({ db, collections });
