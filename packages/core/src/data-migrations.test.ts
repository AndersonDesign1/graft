import type { Database } from "@graft/db";
import { describe, expect, it } from "vitest";
import { defineCollection } from "./collection";
import { defineDataMigration, runDataMigration } from "./data-migrations";
import { field } from "./field";

const submissions = defineCollection({
  name: "submissions",
  authority: "db-authoritative",
  fields: { email: field.string(), message: field.text({ optional: true }) },
});

const lowercaseEmail = defineDataMigration({
  collection: submissions,
  description: "Normalize emails to lowercase",
  transform: ({ data }) => ({
    ...(data as { email: string; message?: string }),
    email: (data.email as string).toLowerCase(),
  }),
});

const row = (id: string, data: Record<string, unknown>) => ({
  id,
  data,
  createdAt: new Date("2026-07-06T00:00:00Z"),
});

/** Read-only drizzle stub: dry-run must never call update/insert/transaction. */
function dryRunDb(rows: unknown[]): Database {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: async () => rows,
        }),
      }),
    }),
  } as unknown as Database;
}

describe("defineDataMigration", () => {
  it("refuses file-authoritative collections at definition time", () => {
    const pages = defineCollection({ name: "pages", fields: { title: field.string() } });
    expect(() =>
      defineDataMigration({
        collection: pages,
        description: "nope",
        transform: ({ data }) => data as never,
      }),
    ).toThrowError(/file-authoritative/);
  });
});

describe("runDataMigration (dry-run default)", () => {
  it("counts changed vs unchanged without opening a transaction", async () => {
    const db = dryRunDb([
      row("r1", { email: "ADA@Example.com" }),
      row("r2", { email: "already@lower.case" }),
    ]);
    const report = await runDataMigration({ db, migration: lowercaseEmail, migrationId: "0002" });
    expect(report).toEqual({
      collection: "submissions",
      rows: 2,
      changed: 1,
      unchanged: 1,
      applied: false,
    });
  });

  it("collects schema failures per row and reports MIGRATION_FAILED", async () => {
    const broken = defineDataMigration({
      collection: submissions,
      description: "Drops the required email",
      transform: () => ({}) as never,
    });
    const db = dryRunDb([row("r1", { email: "a@b.co" })]);
    const error = await runDataMigration({ db, migration: broken, migrationId: "x" }).catch(
      (e) => e,
    );
    expect(error.code).toBe("MIGRATION_FAILED");
    expect(error.details.failures[0].id).toBe("r1");
  });

  it("collects transform throws per row", async () => {
    const throwing = defineDataMigration({
      collection: submissions,
      description: "Throws",
      transform: () => {
        throw new Error("boom");
      },
    });
    const db = dryRunDb([row("r1", { email: "a@b.co" })]);
    const error = await runDataMigration({ db, migration: throwing, migrationId: "x" }).catch(
      (e) => e,
    );
    expect(error.code).toBe("MIGRATION_FAILED");
    expect(error.details.failures[0].reason).toContain("boom");
  });
});
