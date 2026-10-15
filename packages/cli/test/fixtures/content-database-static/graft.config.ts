import { defineCollection, field } from "@usegraft/core";

export const pages = defineCollection({
  name: "pages",
  fields: {
    title: field.string(),
  },
});

export const collections = { pages };

export const index = "static";

export const content = { source: "database" };
