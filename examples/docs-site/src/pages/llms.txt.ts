/**
 * /llms.txt — the llmstxt.org index, generated from the content index.
 *
 * Links are absolute, and the origin comes from the configured `site` — not
 * from the request. It used to come from the request, which was right while
 * this route was server-rendered: one expression covered localhost, previews
 * and production with nothing to keep in step. Going static (db5abe6) removed
 * the request. Prerendering supplies Astro's placeholder instead, so every link
 * shipped as http://localhost:4321 while the file still built, deployed and
 * returned 200. `site` is the only origin a prerendered route can trust.
 *
 * ⚠️ In `astro dev` this route is shadowed. Vite's dev server serves the whole
 * project root as static files — /package.json and /graft.config.ts answer too
 * — and this project has an `llms.txt` at its root: the Graft agent guide that
 * `graft init` scaffolds, which is a different document for a different reader
 * and is not meant to be published. It wins locally because Vite's static
 * middleware runs first, and the giveaway is `cache-control: no-cache` instead
 * of the header below. The built output contains no root files at all and the
 * route is in the production manifest, so deployed behaviour is this file.
 * Verify with `astro build`, not the dev server.
 */
import type { APIRoute } from "astro";
import { renderLlmsIndex, textResponse } from "../lib/llms";
import { docsNav } from "../lib/nav";

export const GET: APIRoute = async ({ site, url }) =>
  textResponse(renderLlmsIndex(await docsNav(), (site ?? url).origin), "text/plain");
