import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HANDLERS } from "./handlers";
import { COMMANDS, commandId, flagsOf, usageOf } from "./registry";

describe("the command registry", () => {
  it("names every command once", () => {
    const ids = COMMANDS.map(commandId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has a handler for every command, and a command for every handler", () => {
    expect([...HANDLERS.keys()].sort()).toEqual(COMMANDS.map(commandId).sort());
  });

  it.each(COMMANDS.map((spec) => [commandId(spec), spec] as const))(
    "graft %s declares each flag name and letter once",
    (_id, spec) => {
      const flags = flagsOf(spec);
      const names = flags.map((flag) => flag.name);
      const letters = flags.flatMap((flag) => (flag.short ? [flag.short] : []));
      expect(new Set(names).size).toBe(names.length);
      expect(new Set(letters).size).toBe(letters.length);
    },
  );

  it("never takes a secret as a flag value, where it would land in shell history and ps", () => {
    const secretish = COMMANDS.flatMap((spec) =>
      flagsOf(spec)
        .filter((flag) => flag.type !== "boolean" && /token|secret|password|key$/i.test(flag.name))
        .map((flag) => `graft ${commandId(spec)} --${flag.name}`),
    );
    expect(secretish).toEqual([]);
  });

  it("writes usage from the declared arguments and flags", () => {
    const create = COMMANDS.find((spec) => commandId(spec) === "branch create");
    expect(create && usageOf(create)).toBe(
      "graft branch create <name> [--from <parent>] [--backend overlay|neon] [--json]",
    );
    const pull = COMMANDS.find((spec) => commandId(spec) === "pull");
    expect(pull && usageOf(pull)).toBe(
      "graft pull [doc...] [--branch <id>] [--only <doc>]... [--force] [--json]",
    );
  });

  // `graft --help` loads these and nothing else, so they stay data: any
  // runtime import here would be paid by every command, typo and --version.
  it.each(["registry.ts", "topics.ts"])("%s imports nothing at runtime", (file) => {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    const imports = source.split("\n").filter((line) => /^import\s/.test(line));
    expect(imports.filter((line) => !line.startsWith("import type "))).toEqual([]);
  });
});
