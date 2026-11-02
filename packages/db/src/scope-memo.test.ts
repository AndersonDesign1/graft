import { describe, expect, it } from "vitest";
import type { BranchScope } from "./branch";
import { memoizeScopes } from "./scope-memo";

const scope = (branch: string): BranchScope => ({
  kind: "overlay",
  chain: [branch],
  writeBranch: branch,
});

describe("memoizeScopes", () => {
  it("looks a branch up once and shares it between reads", async () => {
    const looked: string[] = [];
    const scopeFor = memoizeScopes(async (branch) => {
      looked.push(branch);
      return scope(branch);
    });

    await Promise.all([scopeFor("main"), scopeFor("main")]);
    await scopeFor("main");
    await scopeFor("preview");

    expect(looked).toEqual(["main", "preview"]);
  });

  it("forgets a failed lookup, so the next read tries again", async () => {
    let calls = 0;
    const scopeFor = memoizeScopes(async (branch) => {
      calls += 1;
      if (calls === 1) throw new Error("connection reset");
      return scope(branch);
    });

    await expect(scopeFor("main")).rejects.toThrow("connection reset");
    await expect(scopeFor("main")).resolves.toEqual(scope("main"));
    expect(calls).toBe(2);
  });
});
