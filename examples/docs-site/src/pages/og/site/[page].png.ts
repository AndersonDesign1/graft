/**
 * /og/site/<page>.png: the social card for one marketing page. Prerendered,
 * like the docs cards, so a share costs a static file.
 */
import type { APIRoute, GetStaticPaths } from "astro";
import { MARKETING_CARDS } from "../../../lib/marketing-cards";
import { renderOgCard } from "../../../lib/og";

export const prerender = true;

export const getStaticPaths: GetStaticPaths = () =>
  Object.entries(MARKETING_CARDS).map(([page, card]) => ({ params: { page }, props: card }));

export const GET: APIRoute = async ({ props }) => {
  const png = await renderOgCard({
    title: String(props.title),
    description: String(props.description),
    section: String(props.section),
    brand: "graft.",
    footer: "graft.page",
  });
  return new Response(new Uint8Array(png), {
    headers: { "content-type": "image/png" },
  });
};
