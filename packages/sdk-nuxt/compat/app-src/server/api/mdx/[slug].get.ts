// The body compiled on the server, for <GraftMdx> to render in the page.
import { createError, defineEventHandler, getRouterParam } from "nuxt/server";

export default defineEventHandler(async (event) => {
  const graft = await useGraft();
  const page = await graft.getContent("pages", getRouterParam(event, "slug") ?? "");
  if (!page) throw createError({ statusCode: 404 });
  return { code: await prepareMdx(page.body) };
});
