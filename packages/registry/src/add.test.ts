import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyPlan, planAdd } from "./add";
import { listItemNames, loadItem, resolveItems } from "./registry";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "graft-reg-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("bundled registry", () => {
  it("lists the bundled items", () => {
    expect(listItemNames()).toEqual([
      "callout",
      "comments",
      "commerce",
      "faq",
      "scoped-access",
      "seo",
    ]);
  });

  it("loads + validates the comments manifest", () => {
    const item = loadItem("comments");
    expect(item.type).toBe("bundle");
    expect(item.registryDependencies).toEqual(["scoped-access"]);
    expect(item.files[0]?.target).toBe("graft/comments.ts");
  });

  it("throws REGISTRY_ITEM_NOT_FOUND for an unknown item, listing what's available", () => {
    expect(() => loadItem("nope")).toThrow(
      expect.objectContaining({
        code: "REGISTRY_ITEM_NOT_FOUND",
        details: {
          name: "nope",
          available: ["callout", "comments", "commerce", "faq", "scoped-access", "seo"],
        },
      }),
    );
  });
});

describe("resolveItems", () => {
  it("pulls registryDependencies in, dependency-first and deduped", () => {
    const items = resolveItems(["comments"]);
    expect(items.map((i) => i.name)).toEqual(["scoped-access", "comments"]);
  });

  it("passes the version gate for a '*' item", () => {
    expect(() => resolveItems(["comments"], { coreVersion: "0.0.0" })).not.toThrow();
  });
});

describe("planAdd / applyPlan", () => {
  it("adds comments (+ its dep), writes the modules, regenerates the barrel, appends llms", () => {
    const plan = planAdd(["comments"], { targetDir: dir });
    expect(plan.items.map((i) => i.name)).toEqual(["scoped-access", "comments"]);
    // relPath is the manifest target verbatim — POSIX separators on every OS.
    expect(plan.files.map((f) => f.relPath).sort()).toEqual([
      "graft/comments.ts",
      "graft/scoped-access.ts",
    ]);
    expect(plan.npmDependencies).toMatchObject({ "@graft/auth": "workspace:*" });
    expect(plan.conflicts).toEqual([]);
    expect(plan.mdxMap).toBeNull();

    const result = applyPlan(plan);
    expect(result.written).toHaveLength(2);
    expect(existsSync(join(dir, "graft", "comments.ts"))).toBe(true);
    expect(existsSync(join(dir, "graft", "scoped-access.ts"))).toBe(true);

    const barrel = readFileSync(join(dir, "graft", "index.ts"), "utf8");
    expect(barrel).toContain('import * as comments from "./comments";');
    expect(barrel).toContain('import * as scopedAccess from "./scoped-access";');
    expect(barrel).toContain("mergePrimitives([comments, scopedAccess])");

    const llms = readFileSync(join(dir, "llms.txt"), "utf8");
    expect(llms).toContain("## comments (primitive)");
    expect(llms).toContain("## scoped-access (primitive)");
  });

  it("adds callout, writes the component, and regenerates the MDX map", () => {
    const plan = planAdd(["callout"], { targetDir: dir });
    expect(plan.items.map((i) => i.name)).toEqual(["callout"]);
    expect(plan.files.map((f) => f.relPath)).toEqual(["components/Callout.tsx"]);
    expect(plan.mdxMap?.relPath.replace(/\\/g, "/")).toBe("components/mdx-components.ts");
    expect(plan.mdxMap?.content).toContain('import { Callout } from "./Callout"');

    const result = applyPlan(plan);
    expect(result.mdxMapPath?.replace(/\\/g, "/")).toBe("components/mdx-components.ts");
    expect(existsSync(join(dir, "components", "Callout.tsx"))).toBe(true);
    const map = readFileSync(join(dir, "components", "mdx-components.ts"), "utf8");
    expect(map).toContain("Callout");
  });

  it("refuses to overwrite a DIFFERING file unless --overwrite, then replaces it", () => {
    mkdirSync(join(dir, "graft"), { recursive: true });
    writeFileSync(join(dir, "graft", "comments.ts"), "// my own version\n", "utf8");

    const plan = planAdd(["comments"], { targetDir: dir });
    expect(plan.conflicts).toContain("graft/comments.ts");
    expect(() => applyPlan(plan)).toThrow(
      expect.objectContaining({ code: "REGISTRY_FILE_EXISTS" }),
    );

    applyPlan(plan, { overwrite: true });
    expect(readFileSync(join(dir, "graft", "comments.ts"), "utf8")).toContain("defineCollection");
  });

  it("re-adding is a no-op on identical files (shared deps don't false-conflict)", () => {
    applyPlan(planAdd(["scoped-access"], { targetDir: dir }));
    expect(readFileSync(join(dir, "graft", "index.ts"), "utf8")).toContain(
      "mergePrimitives([scopedAccess])",
    );

    // comments brings scoped-access again — its file is already there, identical.
    const plan = planAdd(["comments"], { targetDir: dir });
    expect(plan.conflicts).toEqual([]);
    const result = applyPlan(plan);
    expect(result.skipped).toContain("graft/scoped-access.ts");
    expect(result.written).toContain("graft/comments.ts");

    const barrel = readFileSync(join(dir, "graft", "index.ts"), "utf8");
    expect(barrel).toContain("mergePrimitives([comments, scopedAccess])");

    // llms didn't duplicate the scoped-access section.
    const llms = readFileSync(join(dir, "llms.txt"), "utf8");
    expect(llms.match(/## scoped-access \(primitive\)/g)).toHaveLength(1);
  });
});
