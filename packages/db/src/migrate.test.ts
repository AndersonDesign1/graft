import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { GraftError } from "@usegraft/contracts";
import { describe, expect, it } from "vitest";
import { migrationsFolder, readJournal } from "./migrate";

describe("shipped migrations", () => {
  it("resolves the folder that ships in the package", () => {
    const folder = migrationsFolder();
    expect(existsSync(folder)).toBe(true);
    // Every journal entry must have its SQL file next to it, or an npm install
    // would carry a ledger it cannot replay.
    const sqlFiles = readdirSync(folder).filter((name) => name.endsWith(".sql"));
    expect(sqlFiles.length).toBeGreaterThan(0);
    for (const entry of readJournal()) {
      expect(existsSync(join(folder, `${entry.tag}.sql`))).toBe(true);
    }
  });

  it("reads the journal in sequence order", () => {
    const entries = readJournal();
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.map((e) => e.idx)).toEqual(entries.map((_, i) => i));
    expect(entries[0]?.tag).toMatch(/^0000_/);
    // The approval-hardening definer function must still be part of the shipped
    // set — a Postgres tier without it cannot consume approvals safely.
    expect(entries.map((e) => e.tag).join(" ")).toContain("0007");
  });

  it("a missing journal fails with a fix, not a raw ENOENT", () => {
    const error = (() => {
      try {
        readJournal(join(migrationsFolder(), "does-not-exist"));
        return undefined;
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(GraftError);
    expect((error as GraftError).code).toBe("MIGRATION_FAILED");
    expect((error as GraftError).fix).toContain("@usegraft/db");
  });
});
