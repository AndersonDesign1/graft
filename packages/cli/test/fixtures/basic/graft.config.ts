import { defineCollection, field } from "@graft/core";

export const pages = defineCollection({
  name: "pages",
  fields: {
    title: field.string(),
  },
});

export const collections = { pages };
