import { fileURLToPath } from "node:url";
import { withGraft } from "@usegraft/sdk-next/config";
import type { NextConfig } from "next";

// Dev convenience: pull DATABASE_URL from the repo-root .env so the example
// runs without its own env file. Harmless when absent (CI, prod).
try {
  process.loadEnvFile(fileURLToPath(new URL("../../.env", import.meta.url)));
} catch {
  /* no root .env — rely on the ambient environment */
}

// withGraft keeps @usegraft/registry server-external (it reads its bundled
// primitives from disk at runtime) plus any future Graft bundler requirements.
const nextConfig: NextConfig = withGraft({});

export default nextConfig;
