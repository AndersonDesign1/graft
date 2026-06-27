/**
 * Database client — a Drizzle handle over postgres-js.
 *
 * Connection options are derived from the URL so the same code targets Neon
 * (managed, TLS + PgBouncer pooler) and self-hosted Postgres (docker, no TLS).
 */
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Schema = typeof schema;
export type Database = PostgresJsDatabase<Schema>;

export interface DbHandle {
  db: Database;
  sql: ReturnType<typeof postgres>;
  close(): Promise<void>;
}

function isNeonUrl(url: string): boolean {
  return /\.neon\.tech/.test(url);
}

/** postgres-js options derived from the connection URL. */
export function pgOptions(url: string) {
  const requiresSsl = isNeonUrl(url) || /sslmode=require/.test(url);
  return {
    // Neon requires TLS; local docker Postgres does not.
    ssl: (requiresSsl ? "require" : false) as "require" | false,
    // Neon's pooler (PgBouncer, transaction mode) can't use prepared statements.
    prepare: !isNeonUrl(url),
  };
}

/** Create a Drizzle client (and the underlying postgres-js connection) for a URL. */
export function createDb(url: string): DbHandle {
  const sql = postgres(url, pgOptions(url));
  const db = drizzle(sql, { schema });
  return { db, sql, close: () => sql.end() };
}
