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
    expect(await run(["branch"])).toBe(1);
    expect(errors.join("\n")).toContain("Phase 4");
  });

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
