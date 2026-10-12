import { defineCollection, field } from "@usegraft/core";

export const pages = defineCollection({
  name: "pages",
  fields: {
    title: field.string(),
  },
});

export const collections = { pages };

/** Not a source — loadConfig must refuse rather than fall back to git. */
export const content = { source: "postgres" };
