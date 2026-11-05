/**
 * The Graft module for Nuxt 4 and Nuxt 5.
 *
 * ```ts
 * export default defineNuxtConfig({
 *   modules: ["@usegraft/sdk-nuxt"],
 *   graft: { contentApi: true },
 * });
 * ```
 *
 * It wires what the Nuxt guide used to have you write by hand: a server-only
 * `useGraft()` read handle, server-rendered content composables for pages, the
 * routes you ask for, and `<GraftMdx>`. Everything server-side mounts through
 * `@usegraft/sdk-nitro`, so it runs on Nitro 2 (Nuxt 4) and Nitro 3 (Nuxt 5).
 *
 * Only `@nuxt/kit` calls present in both majors are used.
 */
import { existsSync } from "node:fs";
import {
  addComponent,
  addImports,
  addServerHandler,
  addVitePlugin,
  addServerImports,
  createResolver,
  isNuxtMajorVersion,
  defineNuxtModule,
} from "@nuxt/kit";
import type { NuxtModule } from "@nuxt/schema";
import { GraftError } from "@usegraft/contracts";

export interface ModuleOptions {
  /**
   * Your `graft.config.ts`, relative to the Nuxt root directory. The module
   * imports `collections`, `functions` and `index` from it.
   */
  config: string;
  /**
   * Mount the read-only content API at `/api/content/v1`. The page
   * composables (`useGraftContent`, `useGraftList`, `useGraftSearch`) read
   * through it, so turn it on to use them.
   */
  contentApi: boolean;
  /** Mount typed functions at `/api/fn/:name`. Needs the Postgres engine. */
  functions: boolean;
  /** Mount MCP at `/api/mcp`. Needs the Postgres engine. */
  mcp: boolean;
}

/** What the module adds to `runtimeConfig`. Each field takes a `NUXT_GRAFT_*` variable. */
export interface GraftRuntimeConfig {
  /** `NUXT_GRAFT_DATABASE_URL`. Falls back to `DATABASE_URL` when empty. */
  databaseUrl: string;
  /** `NUXT_GRAFT_STATIC_INDEX`: the static index file, when the config sets `index = "static"`. */
  staticIndex: string;
  /** `NUXT_GRAFT_DEV_TOKEN`: a bearer token accepted in development only. */
  devToken: string;
  /** `NUXT_GRAFT_DEV_SCOPES`: the dev token's scopes. Empty grants `content:write`. */
  devScopes: string;
  /** `NUXT_GRAFT_TRUSTED_ISSUERS`: JWT issuers, comma or space separated. */
  trustedIssuers: string;
  /** `NUXT_GRAFT_TRUSTED_AUDIENCE`: accepted `aud` values. Empty leaves `aud` unchecked. */
  trustedAudience: string;
  /** `NUXT_GRAFT_TRUSTED_ACTOR_KIND`: `"agent"` (the default) or `"human"`. */
  trustedActorKind: string;
}

const CONFIG_ALIAS = "#graft/config";
const GRAFT_PACKAGES = /@usegraft\//;
const EMPTY_DB = "\0graft:empty-db";

/**
 * The Nitro 2 and Nitro 3 keys that keep a package in the server bundle. Nuxt
 * types the hook's config with neither, so `plugins`, which both share, is
 * listed to let TypeScript accept the config as this shape.
 */
interface NitroInline {
  plugins?: string[];
  externals?: { inline?: (string | RegExp)[] };
  noExternals?: boolean | (string | RegExp)[];
  traceDeps?: (string | RegExp)[];
}

const graftModule: NuxtModule<ModuleOptions> = defineNuxtModule<ModuleOptions>({
  meta: {
    name: "@usegraft/sdk-nuxt",
    configKey: "graft",
    compatibility: { nuxt: ">=4.6.0" },
  },
  defaults: {
    config: "graft.config.ts",
    contentApi: false,
    functions: false,
    mcp: false,
  },
  setup(options, nuxt) {
    const resolver = createResolver(import.meta.url);
    const configPath = createResolver(nuxt.options.rootDir).resolve(options.config);
    if (!existsSync(configPath)) {
      throw new GraftError({
        code: "CONFIG_INVALID",
        message: `@usegraft/sdk-nuxt could not find ${configPath}.`,
        fix: "Create graft.config.ts in the Nuxt root (`graft init` writes one), or point `graft.config` in nuxt.config.ts at yours.",
        details: { config: configPath },
      });
    }

    // One alias for the app, the server and the generated tsconfig, so every
    // runtime file imports the project's own collections, typed.
    nuxt.options.alias[CONFIG_ALIAS] = configPath;

    const defaults: GraftRuntimeConfig = {
      databaseUrl: "",
      staticIndex: "",
      devToken: "",
      devScopes: "",
      trustedIssuers: "",
      trustedAudience: "",
      trustedActorKind: "",
    };
    // What nuxt.config.ts set wins over the defaults; the env vars win at runtime.
    const runtimeGraft = { ...defaults };
    const existing = nuxt.options.runtimeConfig.graft;
    if (typeof existing === "object" && existing !== null) Object.assign(runtimeGraft, existing);
    nuxt.options.runtimeConfig.graft = runtimeGraft;

    // Bundle the runtime and every Graft package into the app's server build
    // instead of leaving them external, so the composables and <GraftMdx> use
    // the app's own Vue, and the server output does not depend on tracing
    // them into .output/server/node_modules.
    nuxt.options.build.transpile.push(resolver.resolve("./runtime"), GRAFT_PACKAGES);
    nuxt.hook("nitro:config", (config) => {
      // The same for the server routes Nitro bundles. Nitro 2 (Nuxt 4) reads
      // `externals.inline`; Nitro 3 (Nuxt 5) reads `noExternals` as a list.
      // Nitro 2 reads any truthy `noExternals` as "no externals at all", which
      // breaks `nuxt dev` on an optional import of a package that is not
      // installed, so the list is set on Nuxt 5 only.
      const nitro: NitroInline = config;
      nitro.externals = {
        ...nitro.externals,
        inline: [...(nitro.externals?.inline ?? []), GRAFT_PACKAGES],
      };
      if (!isNuxtMajorVersion(4, nuxt) && nitro.noExternals !== true) {
        nitro.noExternals = [...(nitro.noExternals || []), GRAFT_PACKAGES];
      }
      // The MDX compiler behind `prepareMdx` stays external and traced. Nuxt
      // aliases `estree-walker`, which it uses, to a stub in the server
      // bundle, so bundling it breaks the build on Nitro 3.
      nitro.traceDeps = [...(nitro.traceDeps ?? []), "@mdx-js/mdx"];
    });

    // The browser build reaches @usegraft/db only through @usegraft/core's
    // lazy imports, which never run there. Resolving it to an empty module in
    // the client build spares Vite from walking the Postgres driver and
    // printing a warning for every Node built-in it imports.
    addVitePlugin({
      name: "graft:no-db-in-the-browser",
      enforce: "pre",
      resolveId(id, _importer, resolveOptions) {
        return id === "@usegraft/db" && resolveOptions?.ssr !== true ? EMPTY_DB : undefined;
      },
      load(id) {
        return id === EMPTY_DB ? "export {};" : undefined;
      },
    });

    addServerImports([
      { name: "useGraft", from: resolver.resolve("./runtime/server/graft") },
      { name: "prepareMdx", from: resolver.resolve("./runtime/server/mdx") },
    ]);

    addImports([
      { name: "useGraftContent", from: resolver.resolve("./runtime/app/composables") },
      { name: "useGraftList", from: resolver.resolve("./runtime/app/composables") },
      { name: "useGraftSearch", from: resolver.resolve("./runtime/app/composables") },
    ]);

    addComponent({
      name: "GraftMdx",
      export: "MdxContent",
      filePath: resolver.resolve("./runtime/app/mdx"),
    });

    if (options.contentApi) {
      addServerHandler({
        route: "/api/content/v1/**",
        handler: resolver.resolve("./runtime/server/content"),
      });
    }
    if (options.functions) {
      addServerHandler({
        route: "/api/fn/**",
        handler: resolver.resolve("./runtime/server/functions"),
      });
    }
    if (options.mcp) {
      addServerHandler({ route: "/api/mcp", handler: resolver.resolve("./runtime/server/mcp") });
    }
  },
});

export default graftModule;
