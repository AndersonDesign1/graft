/**
 * withGraft — wrap a Next config with everything a Graft app needs from the
 * bundler, so consuming apps can't forget it.
 *
 * Today that is one thing: `@usegraft/registry` reads its bundled primitives from
 * disk at runtime (registryRoot() → the package's registry/ dir in
 * node_modules), so it must stay server-external — bundling it breaks
 * list_registry / describe_item at runtime with no build-time error. Future
 * Graft-wide Next requirements land here instead of in every app's config.
 *
 * The key for that moved between majors: Next 14 reads
 * `experimental.serverComponentsExternalPackages`, Next 15 promoted it to
 * `serverExternalPackages` and warns about the old one, and Next 14 rejects
 * the new one as unrecognized. So the installed Next decides which key is set.
 *
 * Shipped as its own `@usegraft/sdk-next/config` entry: next.config.ts is loaded
 * with require semantics and must not drag the React/MDX runtime surface in.
 */
import { createRequire } from "node:module";
import { join } from "node:path";
import type { NextConfig } from "next";

const GRAFT_SERVER_EXTERNALS = ["@usegraft/registry"];

/**
 * The installed Next's major version, or undefined when it cannot be found.
 *
 * Resolved from the app first (the project root is the working directory when
 * Next loads its config), then from this package, which covers a monorepo
 * whose app runs from another directory. Reading package.json beats sniffing
 * for an API: it is the one thing every version ships in the same place.
 */
function installedNextMajor(): number | undefined {
  const bases = [join(process.cwd(), "next.config.js"), import.meta.url];
  for (const base of bases) {
    try {
      const manifest: { version?: unknown } = createRequire(base)("next/package.json");
      const major =
        typeof manifest.version === "string" ? Number.parseInt(manifest.version, 10) : Number.NaN;
      if (Number.isInteger(major)) return major;
    } catch {
      // Not resolvable from this base. Try the next one.
    }
  }
  return undefined;
}

function withExtra(existing: string[]): string[] {
  return [...existing, ...GRAFT_SERVER_EXTERNALS.filter((pkg) => !existing.includes(pkg))];
}

/**
 * Wrap a Next config. Existing externals are kept and nothing is duplicated.
 * When the version cannot be read, the current key is used, since that is
 * what every supported major after 14 expects.
 */
export function withGraft(config: NextConfig = {}): NextConfig {
  const major = installedNextMajor();

  if (major !== undefined && major < 15) {
    const experimental = config.experimental ?? {};
    return {
      ...config,
      experimental: {
        ...experimental,
        serverComponentsExternalPackages: withExtra(
          experimental.serverComponentsExternalPackages ?? [],
        ),
      },
    };
  }

  return {
    ...config,
    serverExternalPackages: withExtra(config.serverExternalPackages ?? []),
  };
}
