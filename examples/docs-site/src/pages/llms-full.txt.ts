/**
 * /llms-full.txt — every doc inline, in the sidebar's reading order.
 *
 * One read of the collection serves both the ordering and the bodies, so this
 * costs the same round trip the docs index page already makes.
 */
import type { APIRoute } from "astro";
import { getGraft } from "../lib/graft";
import { renderLlmsFull, textResponse } from "../lib/llms";
import { docsNav } from "../lib/nav";

export const GET: APIRoute = async ({ url }) => {
  const [sections, docs] = await Promise.all([docsNav(), getGraft().listContent("docs")]);
  const bodies = new Map(
    docs.map((doc) => [
      doc.slug,
      { title: doc.data.title, description: doc.data.description, body: doc.body },
    ]),
  );

  return textResponse(renderLlmsFull(sections, bodies, url.origin), "text/plain");
};
