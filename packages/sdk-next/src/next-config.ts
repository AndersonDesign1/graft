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

/** The `version` field of a package.json, or undefined. */
function versionOf(pkg: unknown): string | undefined {
  return pkg && typeof pkg === "object" && "version" in pkg && typeof pkg.version === "string"
    ? pkg.version
    : undefined;
}

/**
 * The version of `next` the app has installed, or undefined when it can't be
 * read. Looked up beside the config first, then from this package, whose
 * peer is the app's `next`: `next build apps/web` run from a monorepo's root
 * leaves the working directory where no `next` is installed.
 */
export function installedNextVersion(cwd = process.cwd()): string | undefined {
  for (const from of [join(cwd, "package.json"), import.meta.url]) {
    try {
      const version = versionOf(createRequire(from)("next/package.json"));
      if (version) return version;
    } catch {
      // Not resolvable from here; try the next place.
    }
  }
  return undefined;
}

interface Version {
  major: number;
  minor: number;
  patch: number;
  /** A canary, rc or other prerelease, which comes before the release it names. */
  prerelease: boolean;
}

function parse(version: string): Version | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?/.exec(version);
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] !== undefined,
  };
}

/** What to tell someone running this version, or null when there is nothing to say. */
export function nextVersionAdvice(version: string): string | null {
  const parsed = parse(version);
  if (!parsed) return null;
  const { major, minor, patch, prerelease } = parsed;
  if (major < 14 || (major === 14 && minor < 2)) {
    return `Graft supports Next.js 14.2 and later. This app has ${version}.`;
  }
  if (major === 14) {
    return `Next.js 14 no longer gets security fixes, and ${version} has critical advisories that will not be fixed on 14. Graft works with it, but upgrade to 15.5.24 or 16.3.3 or later.`;
  }
  const floor = major === 15 || major === 16 ? PATCHED[major] : undefined;
  const below =
    floor &&
    (minor < floor[0] ||
      (minor === floor[0] && (patch < floor[1] || (patch === floor[1] && prerelease))));
  if (floor && below) {
    return `Next.js ${version} has known critical security advisories. Upgrade to ${major}.${floor[0]}.${floor[1]} or later.`;
  }
  return null;
}

let warned = false;

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((name): name is string => typeof name === "string") : [];

/** Every package in the lists, once each, then Graft's. */
function merged(...lists: string[][]): string[] {
  return [...new Set([...lists.flat(), ...GRAFT_SERVER_EXTERNALS])];
}

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

  // Both names are read from the app's config and written as the one this
  // Next.js reads. Left in place, the other is ignored on 14, and on 15 and
  // later it is moved over `serverExternalPackages`, dropping Graft's entry.
  // The types installed here are 15's or later, which no longer declare the
  // experimental name, so it is narrowed by `in`.
  const { serverExternalPackages: current, experimental, ...rest } = config;
  const { legacy, others } = splitExperimental(experimental);
  const major = version ? parse(version)?.major : undefined;
  if (major !== undefined && major < 15) {
    return {
      ...rest,
      experimental: {
        ...others,
        serverComponentsExternalPackages: merged(legacy, strings(current)),
      },
    };
  }
  const next: NextConfig = { ...rest, serverExternalPackages: merged(strings(current), legacy) };
  if (experimental) next.experimental = others;
  return next;
}

interface ExperimentalSplit {
  /** Next.js 14's externals list, if the app set one. */
  legacy: string[];
  /** Every other experimental setting, as the app wrote it. */
  others: NonNullable<NextConfig["experimental"]>;
}

/** The legacy externals list out of `experimental`, and everything else in it. */
function splitExperimental(experimental: NextConfig["experimental"]): ExperimentalSplit {
  if (!experimental) return { legacy: [], others: {} };
  if (!("serverComponentsExternalPackages" in experimental))
    return { legacy: [], others: experimental };
  const { serverComponentsExternalPackages: legacy, ...others } = experimental;
  return { legacy: strings(legacy), others };
}
