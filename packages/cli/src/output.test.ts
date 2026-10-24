import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exitCodeFor, formatJson, redact, reportError } from "./output";

describe("formatJson", () => {
  it("indents for a terminal and keeps a pipe to one line", () => {
    expect(formatJson({ a: [1] }, true)).toBe('{\n  "a": [\n    1\n  ]\n}');
    expect(formatJson({ a: [1] }, false)).toBe('{"a":[1]}');
  });
});

describe("redact", () => {
  it("hides a Studio agent token but keeps its recognizable start", () => {
    expect(redact("Bearer graft_at_abc123DEF_-xyz failed")).toBe("Bearer graft_at_abc1… failed");
  });
});

describe("exitCodeFor", () => {
  it.each([
    ["USAGE_INVALID", 2],
    ["DESTRUCTIVE_OP_REQUIRES_APPROVAL", 3],
    ["UNAUTHORIZED", 4],
    ["TOKEN_INVALID", 4],
    ["CONFIG_NOT_FOUND", 1],
    ["INTERNAL_ERROR", 1],
  ])("%s exits %i", (code, exit) => {
    expect(exitCodeFor(code)).toBe(exit);
  });
});

describe("reportError", () => {
  let errors: string[];
  beforeEach(() => {
    errors = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.join(" "));
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const error = {
    code: "CONFIG_NOT_FOUND",
    message: "No graft.config.ts here.",
    fix: "Run graft init.",
    details: { cwd: "/tmp" },
  };

  it("prints code, message, fix and details for a person", () => {
    expect(reportError(error, false)).toBe(1);
    expect(errors).toEqual([
      "error CONFIG_NOT_FOUND: No graft.config.ts here.",
      "  fix: Run graft init.",
      '  details: {"cwd":"/tmp"}',
    ]);
  });

  it("prints one JSON line for a script", () => {
    expect(reportError(error, true)).toBe(1);
    expect(errors).toEqual([
      '{"error":"CONFIG_NOT_FOUND","message":"No graft.config.ts here.","fix":"Run graft init.","details":{"cwd":"/tmp"}}',
    ]);
  });
});
