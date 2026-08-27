import { defineCollection, field } from "@usegraft/core";

export const pages = defineCollection({
  name: "pages",
  fields: {
    title: field.string(),
  },
});

export const collections = { pages };

// Deliberately wrong: a typo here must be refused, never quietly defaulted.
export const mdxTrust = "fUll";
