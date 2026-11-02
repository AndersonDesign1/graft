// The shared app in ../app-src is copied in by ../smoke.mjs before each build.
export default defineNuxtConfig({
  compatibilityDate: "2026-10-01",
  modules: ["@usegraft/sdk-nuxt"],
  graft: { contentApi: true, functions: true, mcp: true },
  // Vue reports a hydration mismatch only in development unless this is on.
  // The smoke runs a production build and fails on any console error.
  vite: { define: { __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "true" } },
});
