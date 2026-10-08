/**
 * When a doc's words last changed, from git, at build time.
 *
 * The compiled index records when a compile ran, not when a page changed, so
 * git is the only honest source. A shallow clone (CI and hosting builds often
 * fetch a few commits) would date every older file to the oldest commit it
 * has, which is a wrong date that looks right. So a shallow checkout is
 * deepened once, and if that fails no date is shown rather than a false one.
 */
import { execFileSync } from "node:child_process";

function git(args: string[]): string {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

let history: "full" | "unavailable" | undefined;

function hasFullHistory(): boolean {
  if (history === undefined) {
    try {
      if (git(["rev-parse", "--is-shallow-repository"]) === "true") {
        git(["fetch", "--unshallow", "--quiet"]);
      }
      history = git(["rev-parse", "--is-shallow-repository"]) === "false" ? "full" : "unavailable";
    } catch {
      history = "unavailable";
    }
  }
  return history === "full";
}

/** Last commit date of `repoPath` (relative to the repository root), or undefined. */
export function lastUpdated(repoPath: string): Date | undefined {
  if (!hasFullHistory()) return undefined;
  try {
    const root = git(["rev-parse", "--show-toplevel"]);
    const iso = execFileSync("git", ["log", "-1", "--format=%cI", "--", repoPath], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return iso ? new Date(iso) : undefined;
  } catch {
    return undefined;
  }
}
