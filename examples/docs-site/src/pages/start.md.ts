/**
 * /start.md — the setup guide for an agent helping someone make a site, at a
 * short address worth putting in a prompt or an AGENTS.md. The same Markdown
 * as /docs/start.md, from the same doc.
 */
import type { APIRoute } from "astro";
import { getGraft } from "../lib/graft";
import { renderDocMarkdown, textResponse } from "../lib/llms";

export const GET: APIRoute = async () => {
  const doc = await getGraft().getContent("docs", "start");
  if (!doc) return new Response("Not found.\n", { status: 404 });
  return textResponse(
    renderDocMarkdown({
      title: doc.data.title,
      description: doc.data.description,
      body: doc.body,
    }),
    "text/markdown",
  );
};
