/**
 * withGraft — wrap a Next config with everything a Graft app needs from the
 * bundler, so consuming apps can't forget it.
 *
 * Today that is one thing: `@graft/registry` reads its bundled primitives from
 * disk at runtime (registryRoot() → the package's registry/ dir in
 * node_modules), so it must stay server-external — bundling it breaks
 * list_registry / describe_item at runtime with no build-time error. Future
 * Graft-wide Next requirements land here instead of in every app's config.
 *
 * Shipped as its own `@graft/sdk-next/config` entry: next.config.ts is loaded
 * with require semantics and must not drag the React/MDX runtime surface in.
 */
import type { NextConfig } from "next";

const GRAFT_SERVER_EXTERNALS = ["@graft/registry"];

export function withGraft(config: NextConfig = {}): NextConfig {
  const existing = config.serverExternalPackages ?? [];
  return {
    ...config,
    serverExternalPackages: [
      ...existing,
      ...GRAFT_SERVER_EXTERNALS.filter((pkg) => !existing.includes(pkg)),
    ],
  };
}
