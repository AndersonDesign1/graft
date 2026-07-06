/**
 * Unit: branch-registry guards that short-circuit before any database call.
 * (Overlay read semantics need a live DB — see branch.integration.test.ts.)
 */
import { GraftError } from "@graft/contracts";
import { describe, expect, it } from "vitest";
import { createBranch, dropBranch } from "./branch";
import type { Database } from "./client";

/** A db that fails the test if touched — proves these guards run before Postgres. */
const noDb = new Proxy(
  {},
  {
    get() {
      throw new Error("database should not be queried for pre-validation");
    },
  },
) as unknown as Database;

describe("branch registry guards (no db)", () => {
  it("rejects a non-URL-safe branch name with BRANCH_INVALID", async () => {
    const err = await createBranch(noDb, { name: "Preview Branch!" }).catch((e) => e);
    expect(err).toBeInstanceOf(GraftError);
    expect((err as GraftError).code).toBe("BRANCH_INVALID");
  });

  it("rejects a branch that is its own parent", async () => {
    const err = await createBranch(noDb, { name: "preview", from: "preview" }).catch((e) => e);
    expect(err).toBeInstanceOf(GraftError);
    expect((err as GraftError).code).toBe("BRANCH_INVALID");
  });

  it("refuses to drop main before hitting the db", async () => {
    const err = await dropBranch(noDb, "main").catch((e) => e);
    expect(err).toBeInstanceOf(GraftError);
    expect((err as GraftError).code).toBe("BRANCH_INVALID");
  });

  it("accepts a slash-segmented kebab name (proceeds past validation to the db step)", async () => {
    // A valid name passes validation and reaches the parent-existence check,
    // which touches the proxy — so a non-GraftError proves the name was accepted.
    const err = await createBranch(noDb, { name: "preview/checkout" }).catch((e) => e);
    expect(err).not.toBeInstanceOf(GraftError);
    expect((err as Error).message).toContain("database should not be queried");
  });
});
