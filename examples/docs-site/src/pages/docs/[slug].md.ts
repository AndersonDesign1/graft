/**
 * /docs/<slug>.md — the authored Markdown, straight from the index.
 *
 * The body is already stored as source, so this is a read and a header. It is
 * what /llms.txt links to, and what an agent should fetch instead of scraping
 * the rendered page.
 *
 * 404s rather than falling back to the HTML page: a caller that asked for
 * Markdown and silently got a document shell would parse the shell.
 */
import type { APIRoute, GetStaticPaths } from "astro";
import { getGraft } from "../../lib/graft";
import { renderDocMarkdown, textResponse } from "../../lib/llms";

/**
 * Every doc is known at build time — the index is compiled from files in git —
 * so the whole set prerenders. The 404 branch below still stands: a slug can be
 * requested that the index does not carry, and answering with the HTML shell
 * would hand a Markdown client something it would parse as a document.
 */
export const getStaticPaths: GetStaticPaths = async () => {
  const docs = await getGraft().listContent("docs");
  return docs.map((doc) => ({ params: { slug: doc.slug } }));
};

export const GET: APIRoute = async ({ params }) => {
  const doc = params.slug ? await getGraft().getContent("docs", params.slug) : null;
  if (!doc) {
    return new Response(
      `No document at /docs/${params.slug ?? ""}. See /llms.txt for the index.\n`,
      {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8" },
      },
    );
  }

  return textResponse(
    renderDocMarkdown({
      title: doc.data.title,
      description: doc.data.description,
      body: doc.body,
    }),
    "text/markdown",
  );
};
