/**
 * The project the Next.js guide assumes (examples/docs-site/content/docs/next.mdx).
 * Not in the guide itself: every other file in this folder is a code block
 * from that page, and src/guide.test.ts fails if the two drift apart.
 */
import { defineCollection, defineFunction, field } from "@usegraft/core";

export const pages = defineCollection({
  name: "pages",
  fields: {
    title: field.string(),
    tagline: field.string({ optional: true }),
  },
});

export const pageCount = defineFunction({
  name: "pageCount",
  kind: "query",
  description: "Counts the pages on the current branch.",
  returns: "{ count: number }",
  input: {},
  handler: async () => ({ count: 0 }),
});

export const collections = { pages };
export const functions = { pageCount };
