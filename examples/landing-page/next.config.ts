import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// Dev convenience: pull DATABASE_URL from the repo-root .env so the example
// runs without its own env file. Harmless when absent (CI, prod).
try {
  process.loadEnvFile(fileURLToPath(new URL("../../.env", import.meta.url)));
} catch {
  /* no root .env — rely on the ambient environment */
}

const nextConfig: NextConfig = {};

export default nextConfig;
