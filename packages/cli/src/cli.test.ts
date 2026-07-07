import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "./cli";

let logs: string[];
let errors: string[];

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

describe("run", () => {
  it("prints the version", async () => {
    expect(await run(["--version"])).toBe(0);
    expect(logs.join("\n")).toContain("0.0.0");
  });

  it("prints help when called bare", async () => {
    expect(await run([])).toBe(0);
    expect(logs.join("\n")).toContain("Usage: graft");
  });

  it("rejects unknown commands with help", async () => {
    expect(await run(["frobnicate"])).toBe(1);
    expect(errors.join("\n")).toContain('unknown command "frobnicate"');
  });

  it("names the phase for planned commands", async () => {
    expect(await run(["add"])).toBe(1);
    expect(errors.join("\n")).toContain("Phase 5");
  });

  it("rejects an unknown branch subcommand as a usage error", async () => {
    expect(await run(["branch", "frobnicate"])).toBe(1);
    expect(errors.join("\n")).toContain('unknown branch subcommand "frobnicate"');
  });

  it("branch create requires a name", async () => {
    expect(await run(["branch", "create"])).toBe(1);
    expect(errors.join("\n")).toContain("usage: graft branch create <name>");
  });

  it("branch drop requires a name", async () => {
    expect(await run(["branch", "drop"])).toBe(1);
    expect(errors.join("\n")).toContain("usage: graft branch drop <name>");
  });

  it("merge requires a branch argument", async () => {
    expect(await run(["merge"])).toBe(1);
    expect(errors.join("\n")).toContain("usage: graft merge <branch>");
  });

  it("requires a value for --into", async () => {
    expect(await run(["merge", "preview", "--into"])).toBe(1);
    expect(errors.join("\n")).toContain("--into requires a value");
  });

  it("requires a value for --from", async () => {
    expect(await run(["branch", "create", "x", "--from", "--apply"])).toBe(1);
    expect(errors.join("\n")).toContain("--from requires a value");
  });

  // The merge guards run in an empty dir (no config, no db) — proving they
  // fire first. 30s timeout: the first dynamic import of the command module
  // pays vitest's cold transform of the migration-engine graph.
  it("merge refuses to merge a branch into itself before touching config or db", async () => {
    const dir = mkdtempSync(join(tmpdir(), "graft-cli-merge-self-"));
    try {
      expect(await run(["merge", "preview", "--into", "preview"], { cwd: dir })).toBe(1);
      expect(errors.join("\n")).toContain("BRANCH_INVALID");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("merge refuses to merge main before touching config or db", async () => {
    const dir = mkdtempSync(join(tmpdir(), "graft-cli-merge-main-"));
    try {
      expect(await run(["merge", "main"], { cwd: dir })).toBe(1);
      expect(errors.join("\n")).toContain("BRANCH_INVALID");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("rejects unknown options as usage errors", async () => {
    expect(await run(["compile", "--frob"])).toBe(1);
    expect(errors.join("\n")).toContain('unknown option "--frob"');
  });

  it("requires a value for --branch", async () => {
    expect(await run(["compile", "--branch"])).toBe(1);
    expect(errors.join("\n")).toContain("--branch requires a value");
  });

  it("init scaffolds into the target directory and prints next steps", async () => {
    const dir = mkdtempSync(join(tmpdir(), "graft-cli-init-"));
    try {
      expect(await run(["init", dir])).toBe(0);
      expect(existsSync(join(dir, "graft.config.ts"))).toBe(true);
      expect(logs.join("\n")).toContain("Next steps:");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("compile outside a project prints CONFIG_NOT_FOUND with its fix", async () => {
    const dir = mkdtempSync(join(tmpdir(), "graft-cli-noproj-"));
    try {
      expect(await run(["compile"], { cwd: dir })).toBe(1);
      const output = errors.join("\n");
      expect(output).toContain("CONFIG_NOT_FOUND");
      expect(output).toContain("fix:");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
