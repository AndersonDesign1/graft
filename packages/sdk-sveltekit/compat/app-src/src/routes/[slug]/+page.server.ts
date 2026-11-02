// The SvelteKit guide's read, with its cache tags.
import { error } from "@sveltejs/kit";
import { tagsFor } from "@usegraft/sdk-sveltekit";
import { graft } from "#lib/server/graft.ts";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, setHeaders }) => {
  const page = await graft.getContent("pages", params.slug);
  if (!page) error(404);
  setHeaders({ "Cache-Tag": tagsFor("main", "pages", params.slug).join(",") });
  return { page };
};
