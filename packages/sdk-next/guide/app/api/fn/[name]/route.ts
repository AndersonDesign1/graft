import { createFunctionsHandler } from "@usegraft/core";
import { functions } from "@/graft.config";
import { actor } from "@/lib/actor";
import { db } from "@/lib/graft";

export const POST = createFunctionsHandler({ db, functions, actor });
