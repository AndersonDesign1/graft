import { defineCollection, field } from "@usegraft/core";

export const index = "static";

export const pages = defineCollection({
  name: "pages",
  fields: { title: field.string(), summary: field.string() },
});

export const collections = { pages };
