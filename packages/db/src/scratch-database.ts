/**
 * A throwaway database for integration tests whose tables are not scoped to a
 * branch (Studio accounts), so they never touch rows that belong to anyone
 * else. Created next to the database in `url`, migrated, and dropped after.
 * Not exported from the package: tests import it by path.
 */
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { createDb, pgOptions, type DbHandle } from "./client";
import { runMigrations } from "./migrate";

export interface ScratchDatabase {
  url: string;
  handle: DbHandle;
  drop(): Promise<void>;
}

/** A fresh, migrated database, or null when this role can't create one (outside CI). */
export async function createScratchDatabase(url: string): Promise<ScratchDatabase | null> {
  const name = `graft_it_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const admin = postgres(url, { ...pgOptions(url), max: 1 });
  try {
    await admin.unsafe(`create database ${name}`);
  } catch (error) {
    await admin.end();
    // Locally, a role without CREATE DATABASE skips the tests that need one.
    // In CI they would all report "skipped" behind a green check, so a
    // missing grant fails the run instead.
    if (process.env.CI) throw error;
    return null;
  }
  const scratch = new URL(url);
  scratch.pathname = `/${name}`;
  await runMigrations(scratch.toString());
  const handle = createDb(scratch.toString());
  return {
    url: scratch.toString(),
    handle,
    async drop() {
      await handle.close();
      await admin.unsafe(`drop database if exists ${name} with (force)`);
      await admin.end();
    },
  };
}
