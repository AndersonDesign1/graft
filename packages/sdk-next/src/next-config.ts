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
 * Next.js 15 named the setting `serverExternalPackages`; 14 reads
 * `experimental.serverComponentsExternalPackages` and warns about the new
 * name. withGraft reads the installed Next.js version and writes the one it
 * understands. It also warns, once, when that version has known security
 * advisories, since the peer range no longer refuses it.
 *
 * Shipped as its own `@usegraft/sdk-next/config` entry: next.config.ts is loaded
 * with require semantics and must not drag the React/MDX runtime surface in.
 */
import { createRequire } from "node:module";
import { join } from "node:path";
import type { NextConfig } from "next";

const GRAFT_SERVER_EXTERNALS = ["@usegraft/registry"];

/** The first releases with the fixes for the critical Next.js advisories of 2026. */
const PATCHED = { 15: [5, 24], 16: [3, 3] } as const;

/** The version of `next` the app has installed, or undefined when it can't be read. */
export function installedNextVersion(cwd = process.cwd()): string | undefined {
  try {
    const pkg: unknown = createRequire(join(cwd, "package.json"))("next/package.json");
    if (pkg && typeof pkg === "object" && "version" in pkg && typeof pkg.version === "string") {
      return pkg.version;
    }
  } catch {
    // No next installed beside the config: write the current key.
  }
  return undefined;
}

function parse(version: string): [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

/** What to tell someone running this version, or null when there is nothing to say. */
export function nextVersionAdvice(version: string): string | null {
  const parsed = parse(version);
  if (!parsed) return null;
  const [major, minor, patch] = parsed;
  if (major < 14 || (major === 14 && minor < 2)) {
    return `Graft supports Next.js 14.2 and later. This app has ${version}.`;
  }
  if (major === 14) {
    return `Next.js 14 no longer gets security fixes, and ${version} has critical advisories that will not be fixed on 14. Graft works with it, but upgrade to 15.5.24 or 16.3.3 or later.`;
  }
  const floor = major === 15 || major === 16 ? PATCHED[major] : undefined;
  if (floor && (minor < floor[0] || (minor === floor[0] && patch < floor[1]))) {
    return `Next.js ${version} has known critical security advisories. Upgrade to ${major}.${floor[0]}.${floor[1]} or later.`;
  }
  return null;
}

let warned = false;

export function withGraft(
  config: NextConfig = {},
  options: { nextVersion?: string } = {},
): NextConfig {
  const version = options.nextVersion ?? installedNextVersion();
  const advice = version ? nextVersionAdvice(version) : null;
  if (advice && !warned) {
    warned = true;
    console.warn(`graft: ${advice}`);
  }

  const major = version ? parse(version)?.[0] : undefined;
  if (major !== undefined && major < 15) {
    // Next.js 14 reads this key; the types installed here are 15's or later,
    // which no longer declare it, so it is narrowed by `in` and written by spread.
    const declared = config.experimental ?? {};
    const current =
      "serverComponentsExternalPackages" in declared
        ? declared.serverComponentsExternalPackages
        : undefined;
    const existing = Array.isArray(current)
      ? current.filter((name): name is string => typeof name === "string")
      : [];
    const experimental = {
      ...config.experimental,
      serverComponentsExternalPackages: [
        ...existing,
        ...GRAFT_SERVER_EXTERNALS.filter((pkg) => !existing.includes(pkg)),
      ],
    };
    return { ...config, experimental };
  }

  const existing = config.serverExternalPackages ?? [];
  return {
    ...config,
    serverExternalPackages: [
      ...existing,
      ...GRAFT_SERVER_EXTERNALS.filter((pkg) => !existing.includes(pkg)),
    ],
  };
}
