import { defineCollection, field } from "@usegraft/core";

export const pages = defineCollection({ name: "pages", fields: { title: field.string() } });

export const collections = { pages };

/** Mirroring needs content in the database; git is already git. */
export const content = { source: "git", mirror: { mode: "each" } };
