import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// Dev convenience: pull DATABASE_URL from the repo-root .env so the example
// runs without its own env file. Harmless when absent (CI, prod).
try {
  process.loadEnvFile(fileURLToPath(new URL("../../.env", import.meta.url)));
} catch {
  /* no root .env — rely on the ambient environment */
}

const nextConfig: NextConfig = {
  // @graft/registry reads its bundled primitives from disk at runtime via
  // `new URL("../registry", import.meta.url)` (the list_registry / describe_item
  // MCP tools). Keep it out of the Turbopack bundle so that path resolves to the
  // package's real registry/ dir in node_modules, not a build-time module.
  serverExternalPackages: ["@graft/registry"],
};

export default nextConfig;
