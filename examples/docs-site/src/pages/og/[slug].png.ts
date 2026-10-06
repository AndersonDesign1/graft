/**
 * /og/<slug>.png: the social card for one doc page. Prerendered with the rest
 * of the docs, so a share costs a static file, not a function call.
 */
import type { APIRoute, GetStaticPaths } from "astro";
import { getGraft } from "../../lib/graft";
import { renderOgCard } from "../../lib/og";

export const getStaticPaths: GetStaticPaths = async () => {
  const docs = await getGraft().listContent("docs");
  return docs.map((doc) => ({
    params: { slug: doc.slug },
    props: { title: doc.data.title, description: doc.data.description, section: doc.data.section },
  }));
};

export const GET: APIRoute = async ({ props }) => {
  const png = await renderOgCard({
    title: String(props.title),
    description: String(props.description),
    section: String(props.section),
  });
  return new Response(new Uint8Array(png), {
    headers: { "content-type": "image/png" },
  });
};
