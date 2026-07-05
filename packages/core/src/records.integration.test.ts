import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb, type DbHandle } from "@graft/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defineCollection } from "./collection";
import { field } from "./field";
import { insertRecord, listRecords, type RecordContext } from "./records";

// Best-effort load of repo-root .env; skipped without RUN_INTEGRATION=1 + a database.
try {
  const here = fileURLToPath(new URL(".", import.meta.url));
  process.loadEnvFile(resolve(here, "../../../.env"));
} catch {
  /* no .env present */
}

const runIntegration = process.env.RUN_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const BRANCH = "core-records-it";

const submissions = defineCollection({
  name: "submissions",
  authority: "db-authoritative",
  fields: {
    email: field.string(),
    message: field.text({ optional: true }),
  },
});

describe.skipIf(!runIntegration)("records -> data_records (integration)", () => {
  let handle: DbHandle;
  let ctx: RecordContext;

  beforeAll(() => {
    handle = createDb(process.env.DATABASE_URL as string);
    ctx = {
      db: handle.db,
      branch: BRANCH,
      actor: { kind: "agent", id: "it-agent" },
      correlationId: "it-corr-1",
    };
  });

  afterAll(async () => {
    await handle.sql`delete from data_records where branch_id = ${BRANCH}`;
    await handle.close();
  });

  it("round-trips a validated record with actor + correlation stamps", async () => {
    await handle.sql`delete from data_records where branch_id = ${BRANCH}`;

    const written = await insertRecord(ctx, submissions, {
      email: "it@example.com",
      message: "hello from the integration test",
    });
    expect(written.id).toMatch(/[0-9a-f-]{36}/);
    expect(written).toMatchObject({
      branch: BRANCH,
      collection: "submissions",
      actorKind: "agent",
      actorId: "it-agent",
      correlationId: "it-corr-1",
    });

    const listed = await listRecords(ctx, submissions);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(written.id);
    expect(listed[0]?.data).toEqual({
      email: "it@example.com",
      message: "hello from the integration test",
    });
  }, 60_000);
});
