import { GraftError } from "@graft/contracts";
import { describe, expect, it } from "vitest";
import type { Database } from "./client";
import { searchContent, searchData } from "./search";

// The guard fires before any query is built, so no database is needed.
const noDb = {} as Database;

describe("empty-query guard", () => {
  it("rejects an empty content query with an actionable fix", async () => {
    const error = await searchContent(noDb, { query: "   " }).catch((e) => e);
    expect(error).toBeInstanceOf(GraftError);
    expect(error.code).toBe("INPUT_VALIDATION_FAILED");
    expect(error.fix).toContain("websearch");
  });

  it("rejects an empty data query the same way", async () => {
    const error = await searchData(noDb, { query: "", collection: "submissions" }).catch((e) => e);
    expect(error).toBeInstanceOf(GraftError);
    expect(error.code).toBe("INPUT_VALIDATION_FAILED");
  });
});
