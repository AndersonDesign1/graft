/**
 * Unit: branch-registry guards that short-circuit before any database call,
 * plus the pure scope/URL helpers the backends share.
 * (Overlay read semantics need a live DB — see branch.integration.test.ts;
 * the neon lifecycle needs the live API — see neon.integration.test.ts.)
 */
import { GraftError } from "@graft/contracts";
import { describe, expect, it } from "vitest";
import { createBranch, dropBranch, neonBranchUrl, scopeChain, scopeWriteBranch } from "./branch";
import type { Database } from "./client";
import { neonConfigFromEnv } from "./neon";

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

describe("branch scopes (pure)", () => {
  it("an overlay scope reads its chain and writes its own branch", () => {
    const scope: import("./branch").BranchScope = {
      kind: "overlay",
      chain: ["preview/x", "main"],
      writeBranch: "preview/x",
    };
    expect(scopeChain(scope)).toEqual(["preview/x", "main"]);
    expect(scopeWriteBranch(scope)).toBe("preview/x");
  });

  it("a physical scope reads and writes the default id — the fork IS the branch", () => {
    const scope: import("./branch").BranchScope = { kind: "physical", branch: "preview/x" };
    expect(scopeChain(scope)).toEqual(["main"]);
    expect(scopeWriteBranch(scope)).toBe("main");
  });
});

describe("neonBranchUrl", () => {
  it("swaps the whole host and keeps credentials, database, and params", () => {
    const url = neonBranchUrl(
      "postgresql://user:secret@ep-parent-pooler.eu-central-1.aws.neon.tech/graft?sslmode=require",
      "ep-fork-abc123.c-4.eu-central-1.aws.neon.tech",
    );
    expect(url).toBe(
      "postgresql://user:secret@ep-fork-abc123.c-4.eu-central-1.aws.neon.tech/graft?sslmode=require",
    );
  });
});

describe("neonConfigFromEnv", () => {
  it("requires NEON_API_KEY with an actionable fix", () => {
    const err = (() => {
      try {
        neonConfigFromEnv({ GRAFT_NEON_PROJECT_ID: "some-project" });
      } catch (e) {
        return e;
      }
      return undefined;
    })();
    expect(err).toBeInstanceOf(GraftError);
    expect((err as GraftError).code).toBe("ENV_VAR_MISSING");
    expect((err as GraftError).fix).toContain("console.neon.tech");
  });

  it("requires GRAFT_NEON_PROJECT_ID (project-scoped keys cannot list projects)", () => {
    const err = (() => {
      try {
        neonConfigFromEnv({ NEON_API_KEY: "napi_x" });
      } catch (e) {
        return e;
      }
      return undefined;
    })();
    expect(err).toBeInstanceOf(GraftError);
    expect((err as GraftError).code).toBe("ENV_VAR_MISSING");
    expect((err as GraftError).fix).toContain("GRAFT_NEON_PROJECT_ID");
  });

  it("returns both values when present", () => {
    expect(neonConfigFromEnv({ NEON_API_KEY: "napi_x", GRAFT_NEON_PROJECT_ID: "proj-1" })).toEqual({
      apiKey: "napi_x",
      projectId: "proj-1",
    });
  });
});
