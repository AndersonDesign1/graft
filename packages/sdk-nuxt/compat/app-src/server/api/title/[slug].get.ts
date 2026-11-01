// A typed server read: `title` is a string because graft.config.ts says so.
import { defineEventHandler, getRouterParam } from "nuxt/server";

export default defineEventHandler(async (event) => {
  const graft = await useGraft();
  const page = await graft.getContent("pages", getRouterParam(event, "slug") ?? "");
  const title: string | undefined = page?.data.title;
  return { title: title ?? null };
});
