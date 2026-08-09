/**
 * Tree-merge behaviour: the Studio's content list is filesystem-first and
 * enriched from the compiled index. These cover the four states a document
 * can be in, plus the two failure modes that previously produced a blank UI.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineCollection, field } from "@usegraft/core";
import { parseDocument } from "@usegraft/compiler";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Rows the fake `readContent` will return, keyed by collection. */
let indexRows: Record<string, Array<Record<string, unknown>>> = {};

vi.mock("@usegraft/db", () => ({
  resolveBranchScope: vi.fn(async (_db: unknown, branch: string) => ({
    kind: "overlay",
    chain: [branch],
    writeBranch: branch,
  })),
  readContent: vi.fn(async (_db: unknown, _scope: unknown, o: { collection: string }) => {
    return indexRows[o.collection] ?? [];
  }),
  listBranches: vi.fn(async () => []),
  listCompilations: vi.fn(async () => []),
  listPendingApprovals: vi.fn(async () => []),
  decideApproval: vi.fn(async () => null),
}));

const { createStudioApiHandler } = await import("./api");

const docs = defineCollection({
  name: "docs",
  description: "Docs pages.",
  fields: {
    title: field.string(),
    description: field.string({ optional: true }),
  },
});

const submissions = defineCollection({
  name: "submissions",
  authority: "db-authoritative",
  fields: { title: field.string() },
});

let contentDir: string;

/** Write an .mdx file and return the contentHash the compiler derives from it. */
function writeDoc(collection: string, slug: string, title: string): string {
  const raw = `---\ntitle: ${title}\n---\n\nBody of ${slug}.\n`;
  mkdirSync(join(contentDir, collection), { recursive: true });
  writeFileSync(join(contentDir, collection, `${slug}.mdx`), raw);
  return parseDocument(raw, docs, `${collection}/${slug}.mdx`).contentHash;
}

function indexRow(slug: string, contentHash: string): Record<string, unknown> {
  return {
    slug,
    sourcePath: `docs/${slug}.mdx`,
    contentHash,
    data: { title: slug },
    body: "",
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

async function getTree(collections: Record<string, unknown>) {
  const handler = createStudioApiHandler({
    db: {} as never,
    collections: collections as never,
    contentDir,
  });
  const res = await handler(new Request("http://localhost/api/studio/v1/tree?branch=main"));
  expect(res.status).toBe(200);
  return (await res.json()) as {
    collections: Array<{
      name: string;
      authority: string;
      driftCount: number;
      error?: string;
      documents: Array<{ slug: string; state: string }>;
    }>;
    summary: Record<string, number>;
  };
}

beforeEach(() => {
  contentDir = mkdtempSync(join(tmpdir(), "graft-studio-tree-"));
  indexRows = {};
});

afterEach(() => {
  rmSync(contentDir, { recursive: true, force: true });
});

describe("content tree merge", () => {
  it("reports on-disk documents as unindexed when nothing has been compiled", async () => {
    writeDoc("docs", "getting-started", "Getting started");
    writeDoc("docs", "deploy", "Deploy");

    const tree = await getTree({ docs });
    const collection = tree.collections.find((c) => c.name === "docs");

    // The regression this guards: the index is empty, but the files exist, so
    // the operator must still see them rather than an empty collection.
    expect(collection?.documents.map((d) => d.slug)).toEqual(["deploy", "getting-started"]);
    expect(collection?.documents.every((d) => d.state === "unindexed")).toBe(true);
    expect(tree.summary.unindexed).toBe(2);
    expect(tree.summary.drift).toBe(2);
  });

  it("marks a document synced when the index hash matches the file", async () => {
    const hash = writeDoc("docs", "getting-started", "Getting started");
    indexRows.docs = [indexRow("getting-started", hash)];

    const tree = await getTree({ docs });
    const doc = tree.collections[0]?.documents[0];

    expect(doc?.state).toBe("synced");
    expect(tree.summary.synced).toBe(1);
    expect(tree.summary.drift).toBe(0);
    expect(tree.collections[0]?.driftCount).toBe(0);
  });

  it("marks a document drifted when the file changed since the last compile", async () => {
    writeDoc("docs", "getting-started", "Getting started");
    indexRows.docs = [indexRow("getting-started", "stale-hash-from-an-older-compile")];

    const tree = await getTree({ docs });

    expect(tree.collections[0]?.documents[0]?.state).toBe("drifted");
    expect(tree.summary.drifted).toBe(1);
    expect(tree.collections[0]?.driftCount).toBe(1);
  });

  it("surfaces index rows with no file behind them as orphaned", async () => {
    const hash = writeDoc("docs", "getting-started", "Getting started");
    indexRows.docs = [indexRow("getting-started", hash), indexRow("deleted-page", "whatever")];

    const tree = await getTree({ docs });
    const states = Object.fromEntries(
      (tree.collections[0]?.documents ?? []).map((d) => [d.slug, d.state]),
    );

    // A stale index is the operator's problem to see, not ours to hide.
    expect(states).toEqual({ "getting-started": "synced", "deleted-page": "orphaned" });
    expect(tree.summary.orphaned).toBe(1);
  });

  it("flags db-authoritative collections instead of showing them as empty files", async () => {
    const tree = await getTree({ docs, submissions });
    const db = tree.collections.find((c) => c.name === "submissions");

    expect(db?.authority).toBe("db");
    expect(db?.documents).toEqual([]);
    // They can never drift — no file exists to compare against.
    expect(db?.driftCount).toBe(0);
  });

  it("orders sections by the collection's declared reading order", async () => {
    // Section order is editorial and cannot be inferred: `order` restarts
    // inside each section, so every section has a "1". Declaring it on the
    // collection is what keeps the Studio and the site's own nav in step.
    const guide = defineCollection({
      name: "guide",
      sections: ["Start here", "Content", "Reference"],
      fields: {
        title: field.string(),
        section: field.string(),
        order: field.number({ optional: true }),
      },
    });

    const write = (slug: string, section: string, order: number): void => {
      mkdirSync(join(contentDir, "guide"), { recursive: true });
      writeFileSync(
        join(contentDir, "guide", `${slug}.mdx`),
        `---\ntitle: ${slug}\nsection: ${section}\norder: ${order}\n---\n\nbody\n`,
      );
    };
    // Authored in an order that is neither alphabetical nor the reading path.
    write("cli", "Reference", 1);
    write("assets", "Content", 2);
    write("intro", "Start here", 1);
    write("reading", "Content", 1);
    write("sdk", "Reference", 2);

    const tree = await getTree({ guide });
    const docs = tree.collections[0]?.documents ?? [];

    expect(docs.map((d) => d.slug)).toEqual(["intro", "reading", "assets", "cli", "sdk"]);
  });

  it("sorts unlisted sections last so new content never vanishes", async () => {
    const guide = defineCollection({
      name: "guide",
      sections: ["Start here"],
      fields: { title: field.string(), section: field.string() },
    });
    mkdirSync(join(contentDir, "guide"), { recursive: true });
    for (const [slug, section] of [
      ["brand-new", "Undeclared"],
      ["intro", "Start here"],
    ]) {
      writeFileSync(
        join(contentDir, "guide", `${slug}.mdx`),
        `---\ntitle: ${slug}\nsection: ${section}\n---\n\nbody\n`,
      );
    }

    const tree = await getTree({ guide });

    expect(tree.collections[0]?.documents.map((d) => d.slug)).toEqual(["intro", "brand-new"]);
  });

  it("falls back to alphabetical sections when none are declared", async () => {
    const guide = defineCollection({
      name: "guide",
      fields: { title: field.string(), section: field.string() },
    });
    mkdirSync(join(contentDir, "guide"), { recursive: true });
    for (const [slug, section] of [
      ["zeta", "Zebra"],
      ["alpha", "Apple"],
    ]) {
      writeFileSync(
        join(contentDir, "guide", `${slug}.mdx`),
        `---\ntitle: ${slug}\nsection: ${section}\n---\n\nbody\n`,
      );
    }

    const tree = await getTree({ guide });

    // Not meaningful, but stable — which beats arbitrary.
    expect(tree.collections[0]?.documents.map((d) => d.slug)).toEqual(["alpha", "zeta"]);
  });

  it("degrades one bad collection instead of failing the whole tree", async () => {
    writeDoc("docs", "good", "Good");
    // Missing the required `title`, so parseDocument throws for this file only.
    mkdirSync(join(contentDir, "docs"), { recursive: true });
    writeFileSync(join(contentDir, "docs", "broken.mdx"), `---\ndescription: no title\n---\n`);

    const strict = defineCollection({
      name: "strict",
      fields: { title: field.string() },
    });
    mkdirSync(join(contentDir, "strict"), { recursive: true });
    writeFileSync(join(contentDir, "strict", "fine.mdx"), `---\ntitle: Fine\n---\n\nok\n`);

    const tree = await getTree({ docs, strict });

    expect(tree.collections.find((c) => c.name === "docs")?.error).toBeTruthy();
    // The healthy collection still renders — one bad file used to 500 the lot.
    const ok = tree.collections.find((c) => c.name === "strict");
    expect(ok?.error).toBeUndefined();
    expect(ok?.documents.map((d) => d.slug)).toEqual(["fine"]);
  });
});
