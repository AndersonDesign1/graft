/**
 * The commands that run the project's MCP tools, on a static project with no
 * database: what they print, and that --json is exactly the tool's answer.
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connectInProcess } from "@usegraft/mcp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "./cli";
import { openProjectMcp } from "./project-mcp";

// Inside the package so the scaffolded config's `@usegraft/core` import resolves.
const project = resolve(fileURLToPath(new URL(".", import.meta.url)), "../.test-tmp/cli-tools");

let logs: string[];
let errors: string[];

beforeAll(async () => {
  rmSync(project, { recursive: true, force: true });
  vi.spyOn(console, "log").mockImplementation(() => {});
  expect(await run(["init", project])).toBe(0);
  expect(await run(["compile"], { cwd: project })).toBe(0);
  vi.restoreAllMocks();
});

afterAll(() => {
  rmSync(project, { recursive: true, force: true });
});

beforeEach(() => {
  logs = [];
  errors = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const cli = (...argv: string[]) => run(argv, { cwd: project });

describe("graft content", () => {
  it("lists every document with its title and file", async () => {
    expect(await cli("content")).toBe(0);
    expect(logs).toContain("pages/home  (Hello, Graft)  pages/home.mdx");
  }, 30_000);

  it("prints a document as the file it is", async () => {
    expect(await cli("content", "get", "pages/home")).toBe(0);
    expect(logs[0]).toMatch(/^---\ntitle: 'Hello, Graft'\n/);
  }, 30_000);

  it("--json prints exactly what the MCP tool answers", async () => {
    expect(await cli("content", "get", "pages/home", "--json")).toBe(0);
    const viaCli = JSON.parse(logs[0] ?? "");
    const opened = await openProjectMcp({ cwd: project });
    const tools = await connectInProcess(opened.server);
    try {
      expect(viaCli).toEqual(
        await tools.call("get_content", { collection: "pages", slug: "home" }),
      );
    } finally {
      await tools.close();
      await opened.close();
    }
    logs = [];
    expect(
      await cli(
        "mcp",
        "call",
        "get_content",
        "--input",
        '{"collection":"pages","slug":"home"}',
        "--json",
      ),
    ).toBe(0);
    expect(JSON.parse(logs[0] ?? "")).toEqual(viaCli);
  }, 30_000);

  it("writes a document from an MDX file, checked and compiled", async () => {
    const file = join(project, "about.mdx");
    writeFileSync(file, "---\ntitle: About\n---\n\nWho we are.\n");
    expect(await cli("content", "write", "pages/about", "--file", file)).toBe(0);
    expect(logs).toEqual([
      'Wrote pages/about.mdx on branch "main": +1 added, ~0 changed, -0 removed.',
    ]);
    expect(readFileSync(join(project, "content/pages/about.mdx"), "utf8")).toContain("Who we are.");
  }, 30_000);

  it("refuses data the schema does not accept, with its fix", async () => {
    expect(await cli("content", "write", "pages/bad", "--data", '{"title":1}')).toBe(1);
    expect(errors[0]).toBe(
      'error SCHEMA_VALIDATION_FAILED: pages/bad.mdx does not match collection "pages"',
    );
  }, 30_000);

  it("sets a field on many documents and lists the ones it could not save", async () => {
    expect(
      await cli(
        "content",
        "set",
        "pages",
        "home",
        "missing",
        "--field",
        "tagline",
        "--value",
        "Hi",
        "--json",
      ),
    ).toBe(1);
    const result = JSON.parse(logs[0] ?? "");
    expect(result.saved).toEqual([{ slug: "home", written: "pages/home.mdx" }]);
    expect(result.failed).toEqual([
      expect.objectContaining({ slug: "missing", error: "DOCUMENT_NOT_FOUND" }),
    ]);
  }, 30_000);

  it("names the expected shape of a document id", async () => {
    expect(await cli("content", "get", "home")).toBe(2);
    expect(errors[0]).toBe('graft: "home" is not a document id.');
  });
});

describe("graft explain", () => {
  it("explains a code, outside any project", async () => {
    expect(await run(["explain", "invalid_slug", "--json"], { cwd: "/" })).toBe(0);
    expect(JSON.parse(logs[0] ?? "")).toMatchObject({ code: "INVALID_SLUG" });
  });

  it("suggests the code a typo was meant to be", async () => {
    expect(await run(["explain", "INVALID_SLUGG"], { cwd: "/" })).toBe(2);
    expect(errors.join("\n")).toContain("Did you mean `INVALID_SLUG`?");
  });
});
