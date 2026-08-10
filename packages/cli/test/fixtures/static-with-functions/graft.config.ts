import { defineCollection, defineFunction, field } from "@usegraft/core";

export const index = "static";

export const pages = defineCollection({
  name: "pages",
  fields: {
    title: field.string(),
  },
});

export const orders = defineCollection({
  name: "orders",
  authority: "db-authoritative",
  fields: {
    email: field.string(),
  },
});

export const countPages = defineFunction({
  name: "countPages",
  kind: "query",
  input: {},
  handler: async () => ({ count: 0 }),
});

export const collections = { pages, orders };
export const functions = { countPages };
