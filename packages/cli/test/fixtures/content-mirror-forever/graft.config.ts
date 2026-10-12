import { defineCollection, field } from "@usegraft/core";

export const pages = defineCollection({ name: "pages", fields: { title: field.string() } });

export const collections = { pages };

// Past Node's timer limit: setInterval would fire every millisecond instead.
export const content = {
  source: "database",
  mirror: { mode: "batch", everyMinutes: 50_000 },
};
