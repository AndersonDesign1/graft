import { defineCollection, field } from "@usegraft/core";

export const pages = defineCollection({ name: "pages", fields: { title: field.string() } });

export const collections = { pages };

export const content = {
  source: "database",
  review: { collections: ["legal"], overLines: 50 },
  mirror: { mode: "batch", via: "pull-request", everyMinutes: 30 },
};
