/**
 * /llms.txt — the llmstxt.org index, generated from the content index.
 *
 * The origin comes from the request rather than a configured `site`, so the
 * links are correct on localhost, on a Vercel preview deployment, and in
 * production without anything to keep in step.
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

export const GET: APIRoute = async ({ url }) =>
  textResponse(renderLlmsIndex(await docsNav(), url.origin), "text/plain");
