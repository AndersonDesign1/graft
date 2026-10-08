import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMMAND_HELP, run } from "./cli";

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
    // Assert against the manifest, not a literal: a hardcoded expectation is
    // what let `graft --version` ship as "0.0.0" in 0.1.0.
    const { version } = createRequire(import.meta.url)("../package.json");
    expect(logs.join("\n")).toContain(version);
    expect(version).not.toBe("0.0.0");
  });

  it("prints help when called bare", async () => {
    expect(await run([])).toBe(0);
    expect(logs.join("\n")).toContain("Usage: graft");
  });

  it("rejects unknown commands with help", async () => {
    expect(await run(["frobnicate"])).toBe(1);
    expect(errors.join("\n")).toContain('unknown command "frobnicate"');
  });

  // Every command with help, read from the table itself, so a command added
  // later is covered without editing this list.
  it.each([...COMMAND_HELP.keys()])(
    "graft %s --help prints that command's usage and exits 0",
    async (command) => {
      expect(await run([command, "--help"])).toBe(0);
      expect(logs.join("\n")).toMatch(new RegExp(`^Usage: graft ${command}\\b`));
      expect(errors).toEqual([]);
    },
  );

  it("answers -h after other arguments, even incomplete ones, without running the command", async () => {
    expect(await run(["asset", "put", "-h"])).toBe(0);
    expect(logs.join("\n")).toContain("--overwrite");
    logs = [];
    expect(await run(["merge", "--into", "--help"])).toBe(0);
    expect(logs.join("\n")).toContain("Usage: graft merge");
  });

  it("an unknown command with --help still reports the unknown command", async () => {
    expect(await run(["frobnicate", "--help"])).toBe(1);
    expect(errors.join("\n")).toContain('unknown command "frobnicate"');
  });

  it("graft add with no item name fails, listing what's available", async () => {
    expect(await run(["add"])).toBe(1);
    const output = errors.join("\n");
    expect(output).toContain("REGISTRY_ITEM_NOT_FOUND");
    expect(output).toContain("comments");
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

  it("requires a value for --backend", async () => {
    expect(await run(["branch", "create", "x", "--backend"])).toBe(1);
    expect(errors.join("\n")).toContain("--backend requires a value");
  });

  it("rejects an unknown branch backend before touching the db", async () => {
    expect(await run(["branch", "create", "x", "--backend", "dynamo"])).toBe(1);
    const output = errors.join("\n");
    expect(output).toContain("BRANCH_INVALID");
    expect(output).toContain("--backend neon");
  }, 30_000);

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

  it("init scaffolds a static project and its next steps mention no database", async () => {
    const dir = mkdtempSync(join(tmpdir(), "graft-cli-init-"));
    try {
      expect(await run(["init", dir])).toBe(0);
      expect(existsSync(join(dir, "graft.config.ts"))).toBe(true);
      const output = logs.join("\n");
      expect(output).toContain("static index");
      expect(output).toContain("no database, no environment variables");
      expect(output).not.toContain("DATABASE_URL=postgres");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("init --postgres scaffolds the database tier and says to set DATABASE_URL", async () => {
    const dir = mkdtempSync(join(tmpdir(), "graft-cli-init-pg-"));
    try {
      expect(await run(["init", dir, "--postgres"])).toBe(0);
      const output = logs.join("\n");
      expect(output).toContain("postgres index");
      expect(output).toContain("DATABASE_URL=postgres");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("add copies a primitive (+ its dep) into graft/ and regenerates the barrel", async () => {
    const dir = mkdtempSync(join(tmpdir(), "graft-cli-add-"));
    try {
      await run(["init", dir]);
      logs = [];
      expect(await run(["add", "comments"], { cwd: dir })).toBe(0);
      expect(existsSync(join(dir, "graft", "comments.ts"))).toBe(true);
      expect(existsSync(join(dir, "graft", "scoped-access.ts"))).toBe(true);
      const barrel = readFileSync(join(dir, "graft", "index.ts"), "utf8");
      expect(barrel).toContain("mergePrimitives([comments, scopedAccess])");
      expect(logs.join("\n")).toContain("graft compile");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("add --dry-run previews without writing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "graft-cli-add-dry-"));
    try {
      await run(["init", dir]);
      logs = [];
      expect(await run(["add", "comments", "--dry-run"], { cwd: dir })).toBe(0);
      expect(existsSync(join(dir, "graft", "comments.ts"))).toBe(false);
      expect(logs.join("\n")).toContain("Would add");
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

// Inside the package so the scaffolded config's `@usegraft/core` import resolves.
// Own subdir of .test-tmp: test files run in parallel.
const jsonProject = resolve(fileURLToPath(new URL(".", import.meta.url)), "../.test-tmp/cli-json");

describe("graft compile --json", () => {
  beforeEach(async () => {
    rmSync(jsonProject, { recursive: true, force: true });
    expect(await run(["init", jsonProject])).toBe(0);
    logs = [];
    errors = [];
  });

  afterEach(() => {
    rmSync(jsonProject, { recursive: true, force: true });
  });

  it("prints only the ChangeSet JSON on stdout and the human report on stderr", async () => {
    expect(await run(["compile", "--json"], { cwd: jsonProject })).toBe(0);
    expect(logs).toHaveLength(1);
    const output = JSON.parse(logs[0] ?? "");
    expect(Object.keys(output).sort()).toEqual(["branch", "changes", "gitSha"]);
    expect(output.branch).toBe("main");
    expect(output.gitSha === null || typeof output.gitSha === "string").toBe(true);
    expect(output.changes).toEqual({
      added: ["pages/home"],
      changed: [],
      removed: [],
      unchanged: 0,
    });
    expect(errors.join("\n")).toContain("Compiled 1 doc(s)");

    logs = [];
    expect(await run(["compile", "--json"], { cwd: jsonProject })).toBe(0);
    expect(JSON.parse(logs[0] ?? "").changes).toEqual({
      added: [],
      changed: [],
      removed: [],
      unchanged: 1,
    });
  }, 30_000);

  it("keeps stray console.log output off stdout", async () => {
    // Anything that logs mid-compile (here the config itself, in production a
    // Postgres notice) must not corrupt the JSON a deploy script pipes on.
    appendFileSync(join(jsonProject, "graft.config.ts"), '\nconsole.log("noise");\n');
    expect(await run(["compile", "--json"], { cwd: jsonProject })).toBe(0);
    expect(logs).toHaveLength(1);
    expect(JSON.parse(logs[0] ?? "").branch).toBe("main");
    expect(errors).toContain("noise");
    // The redirect ends with the compile.
    console.log("after");
    expect(logs).toContain("after");
  }, 30_000);

  it("keeps console.info, console.debug and raw stdout writes off stdout", async () => {
    appendFileSync(
      join(jsonProject, "graft.config.ts"),
      '\nconsole.info("noise-info");\nconsole.debug("noise-debug");\nprocess.stdout.write("noise-raw\\n");\n',
    );
    const stdout: string[] = [];
    const stderr: string[] = [];
    const out = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    });
    const err = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    });
    try {
      expect(await run(["compile", "--json"], { cwd: jsonProject })).toBe(0);
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
    expect(stdout.join("")).not.toMatch(/noise/);
    expect(stderr.join("")).toContain("noise-raw");
    expect(errors).toEqual(expect.arrayContaining(["noise-info", "noise-debug"]));
    expect(logs).toHaveLength(1);
    expect(JSON.parse(logs[0] ?? "").branch).toBe("main");
  }, 30_000);

  it("prints nothing on stdout when the compile fails", async () => {
    expect(await run(["compile", "--json", "--branch", "preview"], { cwd: jsonProject })).toBe(1);
    expect(logs).toEqual([]);
    expect(errors.join("\n")).toContain("NEEDS_DATABASE");
  }, 30_000);
});
