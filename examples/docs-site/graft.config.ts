/**
 * The schema for the Graft docs site — collections defined as owned code.
 * Agents: this is the single source of truth for what content exists.
 * Add fields here, then author documents in content/<collection>/<slug>.mdx.
 *
 * Primitives you add with `graft add` live under graft/ and are merged in via
 * the generated graft/index.ts barrel — you never edit the import below.
 */
import { defineCollection, field, mergePrimitives } from "@usegraft/core";
import * as primitives from "./graft";

/** Marketing/landing pages (/, /why). */
export const pages = defineCollection({
  name: "pages",
  description: "Top-level site pages rendered at / and /<slug>.",
  fields: {
    title: field.string({ description: "Page headline (h1) and <title>." }),
    tagline: field.string({ optional: true, description: "Short line under the headline." }),
    description: field.string({
      optional: true,
      description: "Meta description for search/social previews.",
    }),
    faqs: field.array({
      of: field.object({
        fields: {
          question: field.string({ description: "The question, verbatim." }),
          answer: field.string({ description: "A direct answer, 1–3 sentences." }),
        },
        description: "One Q/A pair.",
      }),
      optional: true,
      description: "FAQ entries rendered on the landing page.",
    }),
  },
});

/** Documentation pages, grouped by section and ordered within it. */
export const docs = defineCollection({
  name: "docs",
  description: "Documentation pages rendered at /docs/<slug>, grouped by section.",
  // A reading path, not an alphabet. Declared here rather than in the site's
  // nav so the sidebar, the Studio and agents all sort identically — there is
  // nothing in the documents to infer it from, since `order` restarts inside
  // each section. Unlisted sections sort last, so new content never vanishes.
  sections: ["Start here", "Build", "Operate", "Reference"],
  fields: {
    title: field.string({ description: "Doc page title (h1, sidebar label, <title>)." }),
    description: field.string({ description: "One-line summary shown in listings and meta." }),
    section: field.string({
      description: 'Sidebar group: "Start here", "Build", "Operate", or "Reference".',
    }),
    order: field.number({ optional: true, description: "Sort order within the section." }),
  },
});

// Your own collections/functions + everything under graft/ (added via `graft add`).
// mergePrimitives throws CONFIG_INVALID on a duplicate key — never a silent override.
export const { collections, functions } = mergePrimitives([
  { collections: { pages, docs }, functions: {} },
  primitives,
]);

/**
 * The static index: compile writes a SQLite artifact and nothing here needs a
 * database at runtime.
 *
 * This site is documentation. Its content is MDX in git, and the only reasons
 * it ever required Postgres were a `submissions` collection and two functions
 * that no page in `src/` referenced — declared to exercise the Postgres tier,
 * never rendered. The landing page carries that demo properly: its own
 * `submitContact`, wired to a `<ContactForm />` a visitor can actually post.
 *
 * What this buys: docs that cannot go down with a database, cost nothing per
 * page view, and prerender. `/mcp` still serves agents — the docs MCP handler
 * reads the same artifact through `staticIndexPath`.
 */
export const index = "static";
