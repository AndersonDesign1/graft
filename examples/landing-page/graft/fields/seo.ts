/**
 * seo — spreadable SEO field group (owned code; edit freely).
 *
 * Spread into any collection: `fields: { title: field.string(), ...seoFields }`.
 * All fields optional so existing documents keep compiling. Wire into
 * `generateMetadata` (or your framework's head helper) from the page data.
 */
import { field } from "@graft/core";

/** Optional SEO fields — spread into a collection's `fields` map. */
export const seoFields = {
  seoTitle: field.string({
    optional: true,
    description: "Override <title> / og:title. Falls back to the page title when unset.",
  }),
  seoDescription: field.string({
    optional: true,
    description: "Meta description / og:description for search and social previews.",
  }),
  ogImage: field.asset({
    optional: true,
    description: "Open Graph image. Upload with `graft asset put <file> [key]`.",
  }),
};
