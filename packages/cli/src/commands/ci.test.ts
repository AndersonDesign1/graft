/**
 * graft ci, on a real git repository: a content-only change is told apart
 * from a code change, and a deploy is skippable only when the content is
 * already live from the database.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ciChanges, ciInit, ciSkipBuild } from "./ci";

const here = fileURLToPath(new URL(".", import.meta.url));
// Inside the package, so the project's graft.config.ts resolves @usegraft/core.
const scratch = resolve(here, "../../test");

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const made: string[] = [];
beforeEach(() => {
  // CI sets these for its own run; the scratch repositories have no such commits.
  for (const name of [
    "GITHUB_BASE_REF",
    "GITHUB_EVENT_NAME",
    "GITHUB_EVENT_PATH",
    "VERCEL_GIT_PREVIOUS_SHA",
  ]) {
    vi.stubEnv(name, "");
  }
});
afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const head = (dir: string) => git(dir, "rev-parse", "HEAD").trim();

function repo(source: "git" | "database"): string {
  const dir = mkdtempSync(join(scratch, "tmp-ci-"));
  made.push(dir);
  writeFileSync(
    join(dir, "graft.config.ts"),
    [
      'import { defineCollection, field } from "@usegraft/core";',
      'export const pages = defineCollection({ name: "pages", fields: { title: field.string() } });',
      "export const collections = { pages };",
      `export const content = { source: "${source}" };`,
      "",
    ].join("\n"),
  );
  mkdirSync(join(dir, "content", "pages"), { recursive: true });
  writeFileSync(join(dir, "content", "pages", "home.mdx"), "---\ntitle: Home\n---\n");
  writeFileSync(join(dir, "app.ts"), "export const app = 1;\n");
  git(dir, "init", "-q", "-b", "main");
  git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "add", ".");
  git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
  return dir;
}

function commit(dir: string, file: string, body: string): void {
  writeFileSync(join(dir, file), body);
  git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qam", `edit ${file}`);
}

describe("graft ci", () => {
  it("calls a change to content alone content-only, and a code change not", async () => {
    const dir = repo("git");
    commit(dir, "content/pages/home.mdx", "---\ntitle: Welcome\n---\n");
    expect(await ciChanges({ cwd: dir })).toMatchObject({
      contentOnly: true,
      files: ["content/pages/home.mdx"],
    });
    commit(dir, "app.ts", "export const app = 2;\n");
    expect((await ciChanges({ cwd: dir })).contentOnly).toBe(false);
  });

  it("skips a deploy only for content already live from the database", async () => {
    const database = repo("database");
    commit(database, "content/pages/home.mdx", "---\ntitle: Welcome\n---\n");
    expect((await ciSkipBuild({ cwd: database, base: "HEAD~1" })).skip).toBe(true);
    commit(database, "app.ts", "export const app = 2;\n");
    expect((await ciSkipBuild({ cwd: database, base: "HEAD~1" })).skip).toBe(false);

    const files = repo("git");
    commit(files, "content/pages/home.mdx", "---\ntitle: Welcome\n---\n");
    expect((await ciSkipBuild({ cwd: files, base: "HEAD~1" })).skip).toBe(false);
  });

  it("compares a deploy with the one before it, not just the last commit", async () => {
    const dir = repo("database");
    const deployed = head(dir);
    // One push: a code change, then a content change on top.
    commit(dir, "app.ts", "export const app = 2;\n");
    commit(dir, "content/pages/home.mdx", "---\ntitle: Welcome\n---\n");

    // Only the last commit to go on: build rather than guess.
    const guessed = await ciSkipBuild({ cwd: dir });
    expect(guessed.skip).toBe(false);
    expect(guessed.reason).toContain("--base");

    vi.stubEnv("VERCEL_GIT_PREVIOUS_SHA", deployed);
    expect((await ciSkipBuild({ cwd: dir })).skip).toBe(false);
    expect((await ciChanges({ cwd: dir })).files).toEqual(["app.ts", "content/pages/home.mdx"]);

    // A GitHub push event names where the push started.
    vi.stubEnv("VERCEL_GIT_PREVIOUS_SHA", "");
    const event = join(dir, "event.json");
    writeFileSync(event, JSON.stringify({ before: deployed }));
    vi.stubEnv("GITHUB_EVENT_NAME", "push");
    vi.stubEnv("GITHUB_EVENT_PATH", event);
    expect((await ciChanges({ cwd: dir })).base).toBe(deployed);

    // When everything since the last deploy is content, it skips.
    vi.stubEnv("VERCEL_GIT_PREVIOUS_SHA", git(dir, "rev-parse", "HEAD~1").trim());
    expect((await ciSkipBuild({ cwd: dir })).skip).toBe(true);
  });

  it("writes a workflow that checks content, and won't overwrite it unasked", async () => {
    const dir = repo("git");
    await ciInit({ cwd: dir });
    const file = join(dir, ".github", "workflows", "graft-content.yml");
    expect(existsSync(file)).toBe(true);
    const workflow = readFileSync(file, "utf8");
    expect(workflow).toContain('paths: ["content/**"]');
    expect(workflow).toContain("graft check");
    await expect(ciInit({ cwd: dir })).rejects.toMatchObject({ code: "ALREADY_INITIALIZED" });
  });
});
