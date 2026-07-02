/**
 * The schema for this site — collections defined as owned code.
 * Agents: this is the single source of truth for what content exists.
 * Add fields here, then author documents in content/<collection>/*.mdx.
 */
import { defineCollection, field } from "@graft/core";

export const pages = defineCollection({
  name: "pages",
  description: "Marketing pages rendered at / (home) and /<slug>.",
  fields: {
    title: field.string({ description: "Page headline (h1) and <title>." }),
    tagline: field.string({ optional: true, description: "Short line under the headline." }),
    order: field.number({ optional: true, description: "Nav sort order (ascending)." }),
  },
});

export const collections = { pages };
