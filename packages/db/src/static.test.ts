import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GraftError } from "@usegraft/contracts";
import { afterAll, describe, expect, it } from "vitest";
import type { ContentInput } from "./diff";
import { frontText, openStaticIndex, projectStaticContent, toFtsMatch } from "./static";

const dir = mkdtempSync(join(tmpdir(), "graft-static-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const doc = (over: Partial<ContentInput> & { slug: string }): ContentInput => ({
  collection: "pages",
  data: { title: `Title ${over.slug}`, tagline: "compiled words" },
  body: `Body of ${over.slug}. Install the CLI and compile your content.`,
  contentHash: `hash-${over.slug}`,
  sourcePath: `pages/${over.slug}.mdx`,
  ...over,
});

describe("toFtsMatch", () => {
  it("quotes bare words and ANDs them", () => {
    expect(toFtsMatch("install cli")).toBe(`"install" "cli"`);
  });
  it("keeps quoted phrases as one term", () => {
    expect(toFtsMatch('"getting started" guide')).toBe(`"getting started" "guide"`);
  });
  it("maps `or` to OR groups with parens", () => {
    expect(toFtsMatch("cats or dogs")).toBe(`("cats") OR ("dogs")`);
  });
  it("maps -term to NOT", () => {
    expect(toFtsMatch("mint -pepper")).toBe(`"mint" NOT "pepper"`);
  });
  it("never throws on hostile input; internal quotes neutralized", () => {
    expect(toFtsMatch('a"b NEAR( * ) OR')).toContain('"');
    expect(toFtsMatch("- -- -")).toBeNull();
    expect(toFtsMatch("-only -exclusions")).toBeNull();
  });
  it("a leading `or` is a plain word, not an operator", () => {
    expect(toFtsMatch("or else")).toBe(`"or" "else"`);
  });
});

describe("frontText", () => {
  it("collects nested string values only", () => {
    expect(frontText({ a: "x", n: 3, o: { b: "y" }, arr: ["z", 1, { c: "w" }] })).toBe("x y z w");
  });
});

describe("static index round-trip", () => {
  const path = join(dir, ".graft", "index.db");

  it("first projection reports everything added and reads back typed rows", async () => {
    const changes = await projectStaticContent(
      [doc({ slug: "home" }), doc({ slug: "getting-started" })],
      { path, gitSha: "abc123" },
    );
    expect(changes.added.sort()).toEqual(["pages/getting-started", "pages/home"]);
    expect(changes.unchanged).toBe(0);
    expect(existsSync(path)).toBe(true);

    const index = await openStaticIndex(path);
    expect(index.info.gitSha).toBe("abc123");
    expect(index.info.branch).toBe("main");

    const rows = await index.readContent({ collection: "pages" });
    expect(rows.map((r) => r.slug)).toEqual(["getting-started", "home"]);
    expect(rows[0]?.data).toMatchObject({ title: "Title getting-started" });
    expect(rows[0]?.deleted).toBe(false);
    expect(rows[0]?.updatedAt).toBeInstanceOf(Date);

    const one = await index.readContent({ collection: "pages", slug: "home", limit: 1 });
    expect(one).toHaveLength(1);
    expect(one[0]?.sourcePath).toBe("pages/home.mdx");
    await index.close();
  });

  it("recompiles diff correctly and preserves unchanged updated_at", async () => {
    const before = await openStaticIndex(path);
    const beforeRows = await before.readContent({ collection: "pages" });
    const keptAt = beforeRows.find((r) => r.slug === "home")?.updatedAt;
    await before.close();

    const changes = await projectStaticContent(
      [doc({ slug: "home" }), doc({ slug: "pricing", contentHash: "hash-new" })],
      { path },
    );
    expect(changes.unchanged).toBe(1);
    expect(changes.added).toEqual(["pages/pricing"]);
    expect(changes.removed).toEqual(["pages/getting-started"]);

    const index = await openStaticIndex(path);
    const rows = await index.readContent({ collection: "pages" });
    // Removed doc is gone (full rebuild = hard removal; git holds history).
    expect(rows.map((r) => r.slug)).toEqual(["home", "pricing"]);
    expect(rows.find((r) => r.slug === "home")?.updatedAt).toEqual(keptAt);
    await index.close();
  });

  it("searches with stemming, ranking, and snippets", async () => {
    const index = await openStaticIndex(path);
    // porter: "compiling" matches "compile"
    const hits = await index.searchContent({ query: "compiling" });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.snippet).toContain("<b>");
    // slug words outrank body words: search a slug term
    const slugHits = await index.searchContent({ query: "pricing" });
    expect(slugHits[0]?.row.slug).toBe("pricing");
    // collection filter
    expect(await index.searchContent({ query: "compile", collections: [] })).toEqual([]);
    expect(
      (await index.searchContent({ query: "compile", collections: ["pages"] })).length,
    ).toBeGreaterThan(0);
    await index.close();
  });

  it("rejects an empty query with the shared gate; unsearchable input returns []", async () => {
    const index = await openStaticIndex(path);
    await expect(index.searchContent({ query: "  " })).rejects.toMatchObject({
      code: "INPUT_VALIDATION_FAILED",
    });
    expect(await index.searchContent({ query: "-onlyexclusion" })).toEqual([]);
    await index.close();
  });

  it("missing artifact fails with STATIC_INDEX_NOT_FOUND and a fix", async () => {
    const err = await openStaticIndex(join(dir, "nope.db")).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GraftError);
    expect((err as GraftError).code).toBe("STATIC_INDEX_NOT_FOUND");
    expect((err as GraftError).fix).toContain("graft compile");
  });
});
