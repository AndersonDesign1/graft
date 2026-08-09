import { defineCollection, field } from "@usegraft/core";

export const posts = defineCollection({
  name: "posts",
  fields: {
    title: field.string(),
  },
});

export const collections = { posts };
export const contentDir = "docs";
