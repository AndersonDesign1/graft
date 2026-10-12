/**
 * graft ci, on a real git repository: a content-only change is told apart
 * from a code change, and a deploy is skippable only when the content is
 * already live from the database.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ciChanges, ciInit, ciSkipBuild } from "./ci";

const here = fileURLToPath(new URL(".", import.meta.url));
// Inside the package, so the project's graft.config.ts resolves @usegraft/core.
const scratch = resolve(here, "../../test");

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

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
    expect((await ciSkipBuild({ cwd: database })).skip).toBe(true);
    commit(database, "app.ts", "export const app = 2;\n");
    expect((await ciSkipBuild({ cwd: database })).skip).toBe(false);

    const files = repo("git");
    commit(files, "content/pages/home.mdx", "---\ntitle: Welcome\n---\n");
    expect((await ciSkipBuild({ cwd: files })).skip).toBe(false);
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
