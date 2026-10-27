/**
 * Branch scopes, kept free of drizzle so the static engine can use them
 * without loading the Postgres code. `resolveBranchScope` builds one from the
 * database and stays in branch.ts.
 */

/**
 * How reads scope to a branch. `overlay` carries the ancestor chain (leaf-first)
 * and the branch writes land on; `physical` is a self-contained Postgres — a
 * storage fork whose rows keep the DEFAULT branch id (`main`), because the
 * database itself IS the branch. `branch` is the registry name, kept for
 * labeling; queries against a physical scope always read and write `main`.
 */
export type BranchScope =
  | { kind: "overlay"; chain: string[]; writeBranch: string }
  | { kind: "physical"; branch: string };

/** The branch chain (leaf-first) a scope reads across — one element when there's no overlay. */
export function scopeChain(scope: BranchScope): string[] {
  return scope.kind === "overlay" ? scope.chain : ["main"];
}

/** The branch id writes stamp under this scope (a physical fork keeps the default id). */
export function scopeWriteBranch(scope: BranchScope): string {
  return scope.kind === "overlay" ? scope.writeBranch : "main";
}
