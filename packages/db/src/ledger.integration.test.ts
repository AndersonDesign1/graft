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
// A live connection (TLS to a hosted Postgres) can take longer than vitest's
// default 5s on its own; the sibling integration suites allow a minute.
const TEST_TIMEOUT = 60_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!runIntegration)("withMigrationLock", () => {
  it(
    "holds the lock through an idle-in-transaction timeout shorter than the work",
    async () => {
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
      // The second run starts only once the first is inside the lock, so the
      // order checks the lock, not how fast each connection opened.
      let firstHolds!: () => void;
      const firstHoldsLock = new Promise<void>((resolve) => (firstHolds = resolve));
      try {
        const first = withMigrationLock(db, "lock-idle-timeout-test", async () => {
          order.push("first:start");
          firstHolds();
          await sleep(1_000);
          order.push("first:end");
        });
        // Raced with the first run, so a run that fails before `work` (a
        // refused connection) fails the test at once with its own error.
        await Promise.race([firstHoldsLock, first]);
        const second = withMigrationLock(db, "lock-idle-timeout-test", async () => {
          order.push("second");
        });
        await Promise.all([first, second]);
        expect(order).toEqual(["first:start", "first:end", "second"]);
      } finally {
        await client.end();
      }
    },
    TEST_TIMEOUT,
  );
});
