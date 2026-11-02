// The SvelteKit guide's read, with its cache tags and its MDX body.
import { error } from "@sveltejs/kit";
import { tagsFor } from "@usegraft/sdk-sveltekit";
import { prepareMdx } from "@usegraft/sdk-sveltekit/server";
import { graft } from "#lib/server/graft.ts";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, setHeaders }) => {
  const page = await graft.getContent("pages", params.slug);
  if (!page) error(404);
  setHeaders({ "Cache-Tag": tagsFor("main", "pages", params.slug).join(",") });
  // The body as a tree MdxContent renders; it travels in the page data.
  return { page, body: prepareMdx(page.body, { label: `pages/${params.slug}` }) };
};
