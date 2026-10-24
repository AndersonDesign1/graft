/**
 * A static project never loads the Postgres code.
 *
 * drizzle-orm and its Postgres module take about 370 ms to load, which used to
 * be most of a static `graft content get`. The libraries now import them only
 * inside the functions that talk to Postgres, and the static engine imports
 * `@usegraft/db/static`. One top-level value import of `@usegraft/db` anywhere
 * in core, compiler or mcp would undo that silently, so this runs the built
 * CLI the way a person does, under a resolve hook that reports every load.
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const here = fileURLToPath(new URL(".", import.meta.url));
const bin = resolve(here, "../dist/index.js");
const hook = pathToFileURL(resolve(here, "../test/forbid-postgres.mjs")).href;
// Inside the package so the fixture config's `@usegraft/core` import resolves.
const project = resolve(here, "../.test-tmp/static-startup");
const MARKER = "[forbidden-import]";

/** What one run of the CLI left behind. */
interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

function graft(...args: string[]): Run {
  const result = spawnSync(process.execPath, ["--import", hook, bin, ...args], {
    cwd: project,
    encoding: "utf8",
    env: {
      ...process.env,
      // Unreachable on purpose: any attempt to connect would fail the command.
      DATABASE_URL: "postgres://static:nope@127.0.0.1:1/none",
      GRAFT_NO_UPDATE_CHECK: "1",
    },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

beforeAll(() => {
  if (!existsSync(bin)) {
    throw new Error(
      "packages/cli/dist is missing. Build it first: pnpm -r --filter @usegraft/cli... run build",
    );
  }
  rmSync(project, { recursive: true, force: true });
  mkdirSync(resolve(project, ".."), { recursive: true });
  cpSync(resolve(here, "../test/fixtures/static-basic"), project, { recursive: true });
});

afterAll(() => {
  rmSync(project, { recursive: true, force: true });
});

describe("a static project", () => {
  it.each([
    [["--help"]],
    [["compile"]],
    [["check"]],
    [["doctor"]],
    [["content", "list", "pages"]],
    [["content", "get", "pages/home"]],
    [["content", "search", "fixture"]],
  ])(
    "runs graft %j without loading the Postgres code",
    (args) => {
      const run = graft(...args);
      expect(run.stderr.split("\n").filter((line) => line.startsWith(MARKER))).toEqual([]);
      expect(run.status).toBe(0);
    },
    30_000,
  );

  it("writes a document without loading the Postgres code", () => {
    const file = join(project, "second.mdx");
    writeFileSync(file, "---\ntitle: Second\n---\n\nAnother page.\n");
    const run = graft("content", "write", "pages/second", "--file", file);
    expect(run.stderr.split("\n").filter((line) => line.startsWith(MARKER))).toEqual([]);
    expect(run.status).toBe(0);
  }, 30_000);
});

describe("the guard", () => {
  it("sees the Postgres code when something does load it", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", hook, "--input-type=module", "-e", 'await import("@usegraft/db")'],
      { cwd: resolve(here, ".."), encoding: "utf8" },
    );
    expect(result.stderr).toContain(`${MARKER} drizzle-orm`);
  });
});
