/**
 * Integration: the migration lock against a real Postgres (opt-in).
 * Run with: RUN_INTEGRATION=1 and DATABASE_URL set.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { pgOptions } from "./client";
import { withMigrationLock } from "./ledger";
import * as schema from "./schema";

const runIntegration = process.env.RUN_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!runIntegration)("withMigrationLock", () => {
  it("holds the lock through an idle-in-transaction timeout shorter than the work", async () => {
    // Every connection in this pool ends a transaction left idle for 300ms. The
    // lock's transaction is idle for the whole of `work`, so without its own
    // SET LOCAL it would end, free the lock, and let the second run in early.
    const url = process.env.DATABASE_URL as string;
    const client = postgres(url, {
      ...pgOptions(url),
      connection: { idle_in_transaction_session_timeout: 300 },
    });
    const db = drizzle(client, { schema });
    const order: string[] = [];
    try {
      const first = withMigrationLock(db, "lock-idle-timeout-test", async () => {
        order.push("first:start");
        await sleep(1_000);
        order.push("first:end");
      });
      await sleep(100);
      const second = withMigrationLock(db, "lock-idle-timeout-test", async () => {
        order.push("second");
      });
      await Promise.all([first, second]);
      expect(order).toEqual(["first:start", "first:end", "second"]);
    } finally {
      await client.end();
    }
  });
});
