/**
 * The package knowledge base behind the `list_packages` tool.
 *
 * An agent could already discover collections, functions, errors and owned
 * primitives, but nothing told it which `@usegraft/*` package to reach for. A
 * user on Next.js had no way to be told `@usegraft/sdk-next` exists, so the
 * answer depended on the model having read the docs — which is exactly the kind
 * of thing this product refuses to leave to chance elsewhere.
 *
 * Curated rather than derived from the workspace, because the useful answer is
 * "you are on Next.js and you want typed reads in a Server Component", not a
 * manifest listing. A test asserts every published package appears here, so
 * adding one without saying what it is for fails rather than silently going
 * undiscoverable — the same lockstep rule ERROR_KNOWLEDGE keeps with ErrorCodes.
 */

/** Which index a package needs. `either` works on both tiers. */
export type PackageTier = "static" | "postgres" | "either";

export interface PackageGuide {
  name: string;
  /** One line: what it is. */
  role: string;
  /** When you actually need it — the sentence that decides the choice. */
  when: string;
  tier: PackageTier;
  /** The framework this adapter serves, for the "I am on X" question. */
  framework?: "next" | "astro" | "sveltekit" | "react-router" | "tanstack-start" | "react";
  /** True for packages you install directly; false for ones pulled in as deps. */
  direct: boolean;
}

export const PACKAGE_KNOWLEDGE = {
  "@usegraft/cli": {
    name: "@usegraft/cli",
    role: "The `graft` command: init, compile, dev, serve, migrate, merge, add.",
    when: "Always. It scaffolds the project and compiles content into the index.",
    tier: "either",
    direct: true,
  },
  "@usegraft/sdk-next": {
    name: "@usegraft/sdk-next",
    role: "Next.js adapter: typed reads in Server Components, plus route handlers.",
    when: "You are on Next.js (App Router).",
    tier: "either",
    framework: "next",
    direct: true,
  },
  "@usegraft/sdk-astro": {
    name: "@usegraft/sdk-astro",
    role: "Astro adapter: typed reads in components, plus `graftRoute`.",
    when: "You are on Astro.",
    tier: "either",
    framework: "astro",
    direct: true,
  },
  "@usegraft/sdk-sveltekit": {
    name: "@usegraft/sdk-sveltekit",
    role: "SvelteKit adapter: typed reads in load functions, plus route handlers.",
    when: "You are on SvelteKit.",
    tier: "either",
    framework: "sveltekit",
    direct: true,
  },
  "@usegraft/sdk-react-router": {
    name: "@usegraft/sdk-react-router",
    role: "React Router adapter: typed reads in loaders and actions.",
    when: "You are on React Router in framework mode, which runs a server.",
    tier: "either",
    framework: "react-router",
    direct: true,
  },
  "@usegraft/sdk-tanstack-start": {
    name: "@usegraft/sdk-tanstack-start",
    role: "TanStack Start adapter: typed reads in server functions and loaders.",
    when: "You are on TanStack Start.",
    tier: "either",
    framework: "tanstack-start",
    direct: true,
  },
  "@usegraft/sdk-react": {
    name: "@usegraft/sdk-react",
    role: "Browser client: typed reads over the content API, with a provider and hooks.",
    when: "You need reads in the browser — a search box, an editor preview, a widget on an already-rendered page. No database reaches this package.",
    tier: "postgres",
    framework: "react",
    direct: true,
  },
  "@usegraft/sdk-core": {
    name: "@usegraft/sdk-core",
    role: "The framework-agnostic read client the adapters are built on.",
    when: "You are on a framework with no adapter, or you want the client directly.",
    tier: "either",
    direct: true,
  },
  "@usegraft/content-api": {
    name: "@usegraft/content-api",
    role: "The HTTP content API: a handler to mount, and a reader to consume it.",
    when: "Something reads content over HTTP rather than in-process — the browser client, or another service.",
    tier: "either",
    direct: true,
  },
  "@usegraft/mcp": {
    name: "@usegraft/mcp",
    role: "The MCP server: authoring, schema introspection, functions and approvals as tools.",
    when: "You want an agent to read and write content. `graft mcp` and `graft serve` both mount it.",
    tier: "either",
    direct: true,
  },
  "@usegraft/studio": {
    name: "@usegraft/studio",
    role: "The editing UI: documents, compiles, commits, branches and approvals.",
    when: "A human needs to edit without touching the repository.",
    tier: "postgres",
    direct: true,
  },
  "@usegraft/core": {
    name: "@usegraft/core",
    role: "defineCollection, defineFunction, the functions handler, and the field primitives.",
    when: "Always — it is what graft.config.ts imports to declare a schema.",
    tier: "either",
    direct: true,
  },
  "@usegraft/db": {
    name: "@usegraft/db",
    role: "The Postgres schema and Drizzle handle for operational data.",
    when: "You are on the Postgres tier. Never reaches a browser.",
    tier: "postgres",
    direct: true,
  },
  "@usegraft/auth": {
    name: "@usegraft/auth",
    role: "Actor resolution: bearer tokens, OIDC issuers and scopes.",
    when: "You are authenticating callers to functions, MCP or Studio.",
    tier: "postgres",
    direct: true,
  },
  "@usegraft/assets": {
    name: "@usegraft/assets",
    role: "The S3-compatible asset store behind `graft asset put` and `put_asset`.",
    when: "Documents reference images or files.",
    tier: "either",
    direct: true,
  },
  "@usegraft/compiler": {
    name: "@usegraft/compiler",
    role: "Reads authored MDX and projects it into the content index.",
    when: "Pulled in by the CLI. Install directly only to compile from your own code.",
    tier: "either",
    direct: false,
  },
  "@usegraft/contracts": {
    name: "@usegraft/contracts",
    role: "Shared types, error codes and the content-index interface.",
    when: "A dependency of everything. Install directly only to implement your own index reader.",
    tier: "either",
    direct: false,
  },
  "@usegraft/mdx-safety": {
    name: "@usegraft/mdx-safety",
    role: "Refuses executable MDX in authored bodies, per the project's mdxTrust.",
    when: "Pulled in by the compiler and MCP. Install directly only to check MDX yourself.",
    tier: "either",
    direct: false,
  },
  "@usegraft/content-migrations": {
    name: "@usegraft/content-migrations",
    role: "Migrations for authored documents, as opposed to database rows.",
    when: "A schema change needs existing MDX rewritten.",
    tier: "either",
    direct: true,
  },
  "@usegraft/tokens": {
    name: "@usegraft/tokens",
    role: "Graft's design tokens as plain CSS custom properties.",
    when: "You are restyling Studio, or want a UI that matches it. One CSS import, no JavaScript.",
    tier: "either",
    direct: true,
  },
  "@usegraft/registry": {
    name: "@usegraft/registry",
    role: "The owned primitives `graft add` copies into a project.",
    when: "Pulled in by the CLI. Browse the items with list_registry.",
    tier: "either",
    direct: false,
  },
} satisfies Record<string, PackageGuide>;

/**
 * The entries as a uniform list.
 *
 * `satisfies` above keeps the literal keys, which is what makes the lockstep
 * test able to name them — but it also means each value has only the fields it
 * actually wrote, so `framework` is absent from the type of entries that omit
 * it. Widening to PackageGuide once, here, is better than every caller
 * rediscovering that.
 */
export function allPackages(): PackageGuide[] {
  return Object.values(PACKAGE_KNOWLEDGE);
}

/** Adapter for a framework, when one exists. */
export function packageForFramework(framework: string): PackageGuide | undefined {
  return allPackages().find((p) => p.framework === framework);
}
