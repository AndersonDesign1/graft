// The shared app in ../app-src is copied in by ../smoke.mjs before each build.
export default defineNuxtConfig({
  compatibilityDate: "2026-10-01",
  modules: ["@usegraft/sdk-nuxt"],
  graft: { contentApi: true, functions: true, mcp: true },
});
