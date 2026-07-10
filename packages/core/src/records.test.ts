import type { Database } from "@graft/db";
import { describe, expect, expectTypeOf, it } from "vitest";
import { defineCollection } from "./collection";
import { field } from "./field";
import type { DataRecord, DataRecordHit, RecordContext } from "./records";
import { deleteRecord, insertRecord, listRecords, searchRecords, updateRecord } from "./records";

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

/** Drizzle stub: records what insert() got, returns canned rows for select()/delete(). */
function stubDb(
  selectRows: unknown[] = [],
  deleteRows: unknown[] = [],
  updateRows: unknown[] = [],
) {
  const calls: {
    inserted?: Record<string, unknown>;
    deleted?: boolean;
    updated?: Record<string, unknown>;
  } = {};
  const db = {
    delete: () => ({
      where: () => ({
        returning: async () => {
          calls.deleted = true;
          return deleteRows;
        },
      }),
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => {
        calls.updated = v;
        return {
          where: () => ({
            returning: async () => updateRows,
          }),
        };
      },
    }),
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
          limit: async () => selectRows,
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
    await expect(insertRecord(ctx(db), pages, { title: "Home" })).rejects.toMatchObject({
      code: "AUTHORITY_MISMATCH",
    });
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

describe("searchRecords", () => {
  const hit = (id: string, data: Record<string, unknown>, rank: number) => ({
    row: {
      id,
      branchId: "main",
      collection: "submissions",
      data,
      actorKind: "anonymous",
      actorId: null,
      correlationId: null,
      createdAt: new Date(),
    },
    rank,
  });

  it("returns typed, re-validated hits carrying their rank", async () => {
    const { db } = stubDb([hit("r1", { email: "x@y.z", message: "call me" }, 0.61)]);
    const hits = await searchRecords(ctx(db), submissions, "call");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ id: "r1", rank: 0.61 });
    expect(hits[0]?.data).toEqual({ email: "x@y.z", message: "call me" });
  });

  it("rejects an empty query before touching the db", async () => {
    const untouchable = new Proxy(
      {},
      {
        get(_t, prop) {
          throw new Error(`touched db (${String(prop)})`);
        },
      },
    ) as Database;
    await expect(searchRecords(ctx(untouchable), submissions, "  ")).rejects.toMatchObject({
      code: "INPUT_VALIDATION_FAILED",
    });
  });

  it("surfaces schema drift on read as SCHEMA_VALIDATION_FAILED naming the row", async () => {
    const { db } = stubDb([hit("r-bad", { wrong: true }, 0.5)]);
    await expect(searchRecords(ctx(db), submissions, "wrong")).rejects.toMatchObject({
      code: "SCHEMA_VALIDATION_FAILED",
      details: { id: "r-bad" },
    });
  });

  it("refuses file-authoritative collections with AUTHORITY_MISMATCH", async () => {
    const { db } = stubDb();
    await expect(searchRecords(ctx(db), pages, "anything")).rejects.toMatchObject({
      code: "AUTHORITY_MISMATCH",
    });
  });
});

describe("deleteRecord", () => {
  it("hard-deletes by id and returns the removed row's data", async () => {
    const { db, calls } = stubDb([], [{ id: "rec-1", data: { email: "a@b.co" } }]);
    const removed = await deleteRecord(ctx(db), submissions, "rec-1");
    expect(calls.deleted).toBe(true);
    expect(removed).toEqual({ id: "rec-1", data: { email: "a@b.co" } });
  });

  it("throws DOCUMENT_NOT_FOUND when nothing matches (id, branch, collection)", async () => {
    const { db } = stubDb([], []);
    await expect(deleteRecord(ctx(db), submissions, "ghost")).rejects.toMatchObject({
      code: "DOCUMENT_NOT_FOUND",
      details: { collection: "submissions", id: "ghost" },
    });
  });

  it("refuses file-authoritative collections with AUTHORITY_MISMATCH", async () => {
    const { db } = stubDb();
    await expect(deleteRecord(ctx(db), pages, "any")).rejects.toMatchObject({
      code: "AUTHORITY_MISMATCH",
    });
  });
});

describe("updateRecord", () => {
  const stored = (data: Record<string, unknown>) => ({
    id: "rec-1",
    branchId: "main",
    collection: "submissions",
    data,
    actorKind: "anonymous",
    actorId: null,
    correlationId: null,
    createdAt: new Date("2026-07-08T00:00:00Z"),
  });

  it("merges the patch over stored data, re-validates, and writes it back", async () => {
    const { db, calls } = stubDb(
      [stored({ email: "a@b.co", message: "old" })],
      [],
      [stored({ email: "a@b.co", message: "new" })],
    );
    const record = await updateRecord(ctx(db), submissions, "rec-1", { message: "new" });
    expect(calls.updated).toEqual({ data: { email: "a@b.co", message: "new" } });
    expect(record.data).toEqual({ email: "a@b.co", message: "new" });
  });

  it("throws DOCUMENT_NOT_FOUND when the id does not exist", async () => {
    const { db } = stubDb([], [], []);
    await expect(
      updateRecord(ctx(db), submissions, "ghost", { message: "x" }),
    ).rejects.toMatchObject({
      code: "DOCUMENT_NOT_FOUND",
      details: { collection: "submissions", id: "ghost" },
    });
  });

  it("rejects a patch that violates the schema without writing", async () => {
    const { db, calls } = stubDb([stored({ email: "a@b.co" })]);
    await expect(
      updateRecord(ctx(db), submissions, "rec-1", { email: 7 as never }),
    ).rejects.toMatchObject({ code: "SCHEMA_VALIDATION_FAILED", details: { id: "rec-1" } });
    expect(calls.updated).toBeUndefined();
  });

  it("refuses file-authoritative collections with AUTHORITY_MISMATCH", async () => {
    const { db } = stubDb();
    await expect(updateRecord(ctx(db), pages, "any", { title: "x" })).rejects.toMatchObject({
      code: "AUTHORITY_MISMATCH",
    });
  });
});

describe("record type inference", () => {
  // The no-codegen contract at the function boundary: the collection from
  // graft.config.ts types every record helper. Assert on the function types —
  // invoking them would hit the stub db.
  it("insert/list/search/update return the exact document type", () => {
    type Data = { email: string; message?: string };
    expectTypeOf(insertRecord<typeof submissions>).returns.resolves.toEqualTypeOf<
      DataRecord<Data>
    >();
    expectTypeOf(listRecords<typeof submissions>).returns.resolves.toEqualTypeOf<
      DataRecord<Data>[]
    >();
    expectTypeOf(searchRecords<typeof submissions>).returns.resolves.toEqualTypeOf<
      DataRecordHit<Data>[]
    >();
    expectTypeOf(updateRecord<typeof submissions>).returns.resolves.toEqualTypeOf<
      DataRecord<Data>
    >();
    expectTypeOf(updateRecord<typeof submissions>)
      .parameter(3)
      .toEqualTypeOf<Partial<Data>>();
  });
});
