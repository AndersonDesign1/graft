import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveContained } from "./paths";

let root: string;
let outside: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "graft-contain-"));
  outside = mkdtempSync(join(tmpdir(), "graft-outside-"));
  mkdirSync(join(root, "docs"));
  writeFileSync(join(root, "docs", "real.mdx"), "hi");
  writeFileSync(join(outside, "secret.txt"), "id_rsa");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe("resolveContained", () => {
  it("returns the absolute path for something genuinely inside", () => {
    expect(resolveContained(root, "docs/real.mdx")).toBe(resolve(root, "docs", "real.mdx"));
  });

  it("refuses traversal, absolute paths and NUL bytes", () => {
    for (const bad of [
      "../../etc/passwd",
      "docs/../../escape",
      resolve(outside, "secret.txt"),
      "a\0b",
    ]) {
      expect(() => resolveContained(root, bad), bad).toThrowError(
        /INPUT_VALIDATION_FAILED|is |resolves/,
      );
    }
  });

  it("refuses a symlink whose target escapes the root", () => {
    // The case lexical containment misses entirely: the string stays inside,
    // and readFileSync then follows the link out.
    try {
      symlinkSync(join(outside, "secret.txt"), join(root, "docs", "leak.mdx"));
    } catch {
      return; // Windows without developer mode: no symlink privilege.
    }
    expect(() => resolveContained(root, "docs/leak.mdx")).toThrowError(/symbolic link/);
  });

  it("refuses a path whose PARENT is a symlink", () => {
    try {
      symlinkSync(outside, join(root, "linked"), "dir");
    } catch {
      return;
    }
    expect(() => resolveContained(root, "linked/secret.txt")).toThrowError(/symbolic link/);
  });

  it("follows symlinks only when explicitly allowed", () => {
    try {
      symlinkSync(join(outside, "secret.txt"), join(root, "docs", "ok.mdx"));
    } catch {
      return;
    }
    expect(() => resolveContained(root, "docs/ok.mdx", { allowSymlinks: true })).not.toThrow();
  });
});
