import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { withMigrationLock } from "./ledger";
import * as schema from "./schema";

describe("withMigrationLock", () => {
  it("refuses a one-connection pool before taking the lock", async () => {
    // The lock holds one connection for the whole run and the work needs a
    // second; with one, the run would wait on itself forever. The address is
    // unreachable on purpose: the refusal must come before any connection.
    const sql = postgres("postgres://graft:x@127.0.0.1:1/none", { max: 1 });
    const db = drizzle(sql, { schema });
    let ran = false;
    await expect(
      withMigrationLock(db, "main", async () => {
        ran = true;
      }),
    ).rejects.toMatchObject({
      code: "INPUT_VALIDATION_FAILED",
      message: "The migration lock needs a pool of at least 2 connections; this one allows 1.",
    });
    expect(ran).toBe(false);
    await sql.end();
  });
});
