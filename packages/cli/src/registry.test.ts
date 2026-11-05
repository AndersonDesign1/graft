import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HANDLERS } from "./handlers";
import { parseCommand } from "./args";
import {
  COMMANDS,
  FRAMEWORK_NAMES,
  SITE_FRAMEWORKS,
  commandId,
  flagsOf,
  resolveFramework,
  usageOf,
} from "./registry";

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
    const dev = COMMANDS.find((spec) => commandId(spec) === "dev");
    expect(dev && usageOf(dev)).toBe("graft dev [--branch <id>] [-- command...]");
  });

  it("takes graft dev's command only after --, so a stray word is not run", () => {
    const dev = COMMANDS.find((spec) => commandId(spec) === "dev");
    if (!dev) throw new Error("graft dev is not declared");
    expect(parseCommand(dev, ["--", "vite", "dev", "--port", "3000"]).args).toEqual([
      "vite",
      "dev",
      "--port",
      "3000",
    ]);
    expect(() => parseCommand(dev, ["next", "dev"])).toThrowError(
      expect.objectContaining({
        message: 'unexpected argument "next" for graft dev.',
        fix: "Put the command after --, as in: graft dev -- next dev",
      }),
    );
    // Copied back into a shell, the suggestion runs the same words.
    expect(() => parseCommand(dev, ["sh", "-c", "echo it's"])).toThrowError(
      expect.objectContaining({
        fix: `Put the command after --, as in: graft dev -- sh -c 'echo it'\\''s'`,
      }),
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

/**
 * The packages in packages/ that are not a framework `graft create` makes a
 * site in, each with why. A new adapter that is neither here nor in
 * SITE_FRAMEWORKS fails the test below, so it cannot ship without a
 * --framework entry, or a reason it has none.
 */
const NOT_A_SITE: Record<string, string> = {
  "@usegraft/sdk-core": "the reads every adapter shares, not a framework",
  "@usegraft/sdk-nitro": "a server module that serves Graft from a Nitro app, not a site",
  "@usegraft/sdk-react": "the browser client for React; a Vite React site is not made yet",
  "@usegraft/sdk-vue": "the browser client for Vue; a Vite Vue site is not made yet",
};

describe("the frameworks graft create makes a site in", () => {
  const packagesDir = new URL("../../", import.meta.url);
  const adapters = readdirSync(packagesDir)
    .filter((folder) => folder.startsWith("sdk-"))
    .map((folder) => new URL(`${folder}/package.json`, packagesDir))
    .filter((manifest) => existsSync(manifest))
    .map((manifest) => (JSON.parse(readFileSync(manifest, "utf8")) as { name: string }).name);

  it("has an entry, or a reason for none, for every adapter in packages/", () => {
    const listed = new Set<string>([
      ...SITE_FRAMEWORKS.map((framework) => framework.package),
      ...Object.keys(NOT_A_SITE),
    ]);
    expect(adapters.filter((name) => !listed.has(name))).toEqual([]);
  });

  it("names only adapters that exist", () => {
    const named = [
      ...SITE_FRAMEWORKS.map((framework) => framework.package),
      ...Object.keys(NOT_A_SITE),
    ];
    expect(named.filter((name) => !adapters.includes(name))).toEqual([]);
  });

  it("gives every name and short name to one framework only", () => {
    const words = SITE_FRAMEWORKS.flatMap((framework) => [framework.name, ...framework.aliases]);
    expect(words.filter((word, i) => words.indexOf(word) !== i)).toEqual([]);
    expect(words).not.toContain("none");
  });

  it("resolves names and short names in any case, and nothing else", () => {
    expect(resolveFramework("nextjs")).toBe("next");
    expect(resolveFramework("Svelte")).toBe("sveltekit");
    expect(resolveFramework("rr")).toBe("react-router");
    expect(resolveFramework(" TanStack ")).toBe("tanstack-start");
    expect(resolveFramework("astro")).toBe("astro");
    expect(resolveFramework("none")).toBe("none");
    expect(resolveFramework("gatsby")).toBeUndefined();
  });

  it("lists every framework in --framework's usage and help", () => {
    const create = COMMANDS.find((spec) => commandId(spec) === "create");
    const flag = create && flagsOf(create).find((entry) => entry.name === "framework");
    expect(flag?.value).toBe("next|nuxt|sveltekit|astro|react-router|tanstack-start|none");
    for (const name of FRAMEWORK_NAMES) expect(flag?.summary).toContain(name);
  });
});
