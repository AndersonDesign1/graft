/**
 * Unit: the merge replay plan (pure) — which ledger rows a branch owes its
 * target, and in what order. The end-to-end merge needs a live DB — see
 * merge.integration.test.ts.
 */
import type { MigrationAppliedRow } from "@usegraft/db";
import { describe, expect, it } from "vitest";
import { pendingLedgerRows } from "./merge";

const row = (migrationId: string, branchId: string, appliedAt: Date): MigrationAppliedRow => ({
  id: `${branchId}-${migrationId}`,
  branchId,
  migrationId,
  kind: migrationId.includes("content") ? "content" : "data",
  collection: "pages",
  docCount: 1,
  gitSha: null,
  appliedAt,
});

describe("pendingLedgerRows", () => {
  it("returns only rows the target lacks", () => {
    const branch = [
      row("0001-content-shape", "preview", new Date("2026-07-01")),
      row("0002-data-backfill", "preview", new Date("2026-07-02")),
    ];
    const target = [row("0001-content-shape", "main", new Date("2026-06-30"))];
    expect(pendingLedgerRows(branch, target).map((r) => r.migrationId)).toEqual([
      "0002-data-backfill",
    ]);
  });

  it("orders the plan by migration id (file order), not apply time", () => {
    // Applied out of order on the branch — replay must still be file order.
    const branch = [
      row("0002-data-backfill", "preview", new Date("2026-07-01")),
      row("0001-content-shape", "preview", new Date("2026-07-02")),
    ];
    expect(pendingLedgerRows(branch, []).map((r) => r.migrationId)).toEqual([
      "0001-content-shape",
      "0002-data-backfill",
    ]);
  });

  it("is empty when the target is already up to date", () => {
    const shared = [row("0001-content-shape", "preview", new Date())];
    const target = [row("0001-content-shape", "main", new Date())];
    expect(pendingLedgerRows(shared, target)).toEqual([]);
    expect(pendingLedgerRows([], [])).toEqual([]);
  });
});
