/**
 * The server side of the module: one storage engine per server process, and
 * the read handle `useGraft()` built on it. Auto-imported into `server/`.
 *
 * The engine follows `index` in graft.config.ts, the same rule `graft compile`
 * uses: `"static"` opens the SQLite artifact, `"postgres"` (or no `index`
 * export) is Postgres, and any other value is refused with CONFIG_INVALID.
 * Both are opened on first use. Nuxt 4 compiles server code to ES2019, which
 * has no top-level await, and a failed open is forgotten so the next request
 * tries again.
 */
import type { ContentIndexReader } from "@usegraft/contracts";
import { GraftError } from "@usegraft/contracts";
import { createDb, createDbIndexReader, openStaticIndex, type Database } from "@usegraft/db";
import type { AnyGraftFunction } from "@usegraft/core";
import { createGraft, type Graft } from "@usegraft/sdk-nitro";
import * as graftConfig from "#graft/config";
import { useRuntimeConfig } from "nuxt/server";
import { engineFor } from "./engine";
import { runtimeSettings } from "./settings";

type Collections = typeof graftConfig.collections;

/**
 * graft.config.ts's optional exports. Read off this alias rather than the
 * module namespace, so a project that leaves one out gets `undefined` without
 * a bundler warning about a missing export.
 */
export const optionalConfig: {
  readonly index?: unknown;
  readonly functions?: Record<string, AnyGraftFunction>;
  readonly contentDir?: string;
  readonly approvalPolicy?: unknown;
  readonly mdxTrust?: unknown;
} = graftConfig;

/** The one branch a Nuxt app serves. */
export const BRANCH = "main";

interface Opened {
  readonly reader: ContentIndexReader;
  readonly db: Database | undefined;
  readonly graft: Graft<Collections>;
}

let opened: Promise<Opened> | undefined;

function open(): Promise<Opened> {
  opened ??= openEngine().catch((error: unknown) => {
    opened = undefined;
    throw error;
  });
  return opened;
}

async function openEngine(): Promise<Opened> {
  const runtime = runtimeSettings(useRuntimeConfig().graft);
  const engine = engineFor(optionalConfig.index, runtime, process.env, process.cwd());
  const { collections } = graftConfig;
  if (engine.kind === "static") {
    const reader = await openStaticIndex(engine.path);
    return { reader, db: undefined, graft: createGraft({ index: reader, collections }) };
  }
  const { db } = createDb(engine.url);
  return {
    reader: createDbIndexReader(db),
    db,
    graft: createGraft({ db, collections }),
  };
}

/**
 * The typed read handle, for server routes and server utils. Never import it
 * into a page or component: a page's `<script setup>` also runs in the
 * browser. Pages read with `useGraftContent` and friends instead.
 */
export async function useGraft(): Promise<Graft<Collections>> {
  return (await open()).graft;
}

/** The reader the content API route serves. */
export async function useGraftReader(): Promise<ContentIndexReader> {
  return (await open()).reader;
}

/** The Postgres handle the functions and MCP routes need, or a GraftError saying why not. */
export async function useGraftDatabase(route: string): Promise<Database> {
  const { db } = await open();
  if (db === undefined) {
    throw new GraftError({
      code: "CONFIG_INVALID",
      message: `${route} needs the Postgres engine, and graft.config.ts uses the static index.`,
      fix: 'Typed functions and MCP writes keep operational data in Postgres. Set `export const index = "postgres"` and NUXT_GRAFT_DATABASE_URL, or turn this route off in nuxt.config.ts.',
      details: { route },
    });
  }
  return db;
}
