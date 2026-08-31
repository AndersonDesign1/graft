/**
 * `@usegraft/sdk-core/db` — the Postgres edge, kept off the main entry point.
 *
 * `createClient` used to accept a `db` handle directly, which meant
 * `client.ts` imported `createDbIndexReader` from `@usegraft/db` for its
 * *value*. A value import is not erased, so `postgres` and `drizzle-orm`
 * entered the dependency graph of everything downstream — including
 * `@usegraft/sdk-react`, a browser package whose stated premise is that a
 * database handle never reaches a bundle. `npm i @usegraft/sdk-react` installed
 * a Postgres driver.
 *
 * Splitting it here fixes both halves. The main entry takes only a
 * `ContentIndexReader`, so nothing about it references the database package at
 * runtime *or* in its published types; and `@usegraft/db` is an optional peer
 * dependency, so a browser install never pulls it while a server adapter, which
 * declares it outright, always has it.
 */
import { createDbIndexReader, type Database } from "@usegraft/db";
import { createClient, type ClientOptions, type GraftClient } from "./client";
import type { AnyCollection } from "@usegraft/core";

export interface DbClientOptions<TCollections extends Record<string, AnyCollection>> extends Omit<
  ClientOptions<TCollections>,
  "index"
> {
  /** The Postgres index. */
  db: Database;
}

/**
 * A read client over a Postgres handle — `createClient` with the reader built
 * for you. The reader owns the per-branch overlay-scope memo, so build one
 * client per request scope rather than one per read.
 */
export function createDbClient<TCollections extends Record<string, AnyCollection>>(
  options: DbClientOptions<TCollections>,
): GraftClient<TCollections> {
  const { db, ...rest } = options;
  return createClient({ ...rest, index: createDbIndexReader(db) });
}

export type { Database };
