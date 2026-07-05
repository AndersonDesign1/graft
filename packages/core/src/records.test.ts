import type { Database } from "@graft/db";
import { describe, expect, it } from "vitest";
import { defineCollection } from "./collection";
import { field } from "./field";
import type { RecordContext } from "./records";
import { insertRecord, listRecords } from "./records";

const submissions = defineCollection({
  name: "submissions",
  authority: "db-authoritative",
  fields: {
    email: field.string(),
    message: field.text({ optional: true }),
  },
});

const pages = defineCollection({
  name: "pages",
  fields: { title: field.string() },
});

/** Drizzle stub: records what insert() got, returns canned rows for select(). */
function stubDb(selectRows: unknown[] = []) {
  const calls: { inserted?: Record<string, unknown> } = {};
  const db = {
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        calls.inserted = v;
        return {
          returning: async () => [
            {
              id: "rec-1",
              branchId: v.branchId,
              collection: v.collection,
              data: v.data,
              actorKind: v.actorKind,
              actorId: v.actorId,
              correlationId: v.correlationId,
              createdAt: new Date("2026-07-05T00:00:00Z"),
            },
          ],
        };
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => selectRows,
          }),
        }),
      }),
    }),
  } as unknown as Database;
  return { db, calls };
}

function ctx(db: Database): RecordContext {
  return {
    db,
    branch: "main",
    actor: { kind: "agent", id: "agent-1" },
    correlationId: "corr-1",
  };
}

describe("insertRecord", () => {
  it("validates, stamps actor + correlation, and returns the typed row", async () => {
    const { db, calls } = stubDb();
    const record = await insertRecord(ctx(db), submissions, { email: "a@b.co" });

    expect(calls.inserted).toMatchObject({
      branchId: "main",
      collection: "submissions",
      data: { email: "a@b.co" },
      actorKind: "agent",
      actorId: "agent-1",
      correlationId: "corr-1",
    });
    expect(record).toMatchObject({ id: "rec-1", collection: "submissions" });
    expect(record.data.email).toBe("a@b.co");
  });

  it("rejects data violating the collection schema before touching the db", async () => {
    const untouchable = new Proxy(
      {},
      {
        get(_t, prop) {
          throw new Error(`touched db (${String(prop)})`);
        },
      },
    ) as Database;

    await expect(
      insertRecord(ctx(untouchable), submissions, { email: 7 } as never),
    ).rejects.toMatchObject({
      code: "SCHEMA_VALIDATION_FAILED",
      details: { collection: "submissions" },
    });
  });

  it("refuses file-authoritative collections with AUTHORITY_MISMATCH", async () => {
    const { db } = stubDb();
    await expect(
      insertRecord(ctx(db), pages, { title: "Home" }),
    ).rejects.toMatchObject({ code: "AUTHORITY_MISMATCH" });
  });
});

describe("listRecords", () => {
  const row = (id: string, data: Record<string, unknown>) => ({
    id,
    branchId: "main",
    collection: "submissions",
    data,
    actorKind: "anonymous",
    actorId: null,
    correlationId: null,
    createdAt: new Date(),
  });

  it("returns typed, re-validated records", async () => {
    const { db } = stubDb([row("r1", { email: "x@y.z", message: "hi" })]);
    const records = await listRecords(ctx(db), submissions);
    expect(records).toHaveLength(1);
    expect(records[0]?.data).toEqual({ email: "x@y.z", message: "hi" });
  });

  it("surfaces schema drift on read as SCHEMA_VALIDATION_FAILED naming the row", async () => {
    const { db } = stubDb([row("r-bad", { wrong: true })]);
    await expect(listRecords(ctx(db), submissions)).rejects.toMatchObject({
      code: "SCHEMA_VALIDATION_FAILED",
      details: { id: "r-bad" },
    });
  });

  it("refuses file-authoritative collections with AUTHORITY_MISMATCH", async () => {
    const { db } = stubDb();
    await expect(listRecords(ctx(db), pages)).rejects.toMatchObject({
      code: "AUTHORITY_MISMATCH",
    });
  });
});
