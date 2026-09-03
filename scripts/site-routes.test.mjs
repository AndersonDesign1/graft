/**
 * Lock: a custom-slug doc and a nested doc must produce the routes the
 * compiler wrote, not the filename. A full site build is not required.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { authoredRoutesFromIndex, expectedStaticFiles } from "./site-routes.mjs";

const dir = mkdtempSync(join(tmpdir(), "graft-site-routes-"));
const dbPath = join(dir, "index.db");

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

function seed() {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE content_index (
      collection TEXT NOT NULL,
      slug TEXT NOT NULL,
      data TEXT NOT NULL,
      body TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      source_path TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (collection, slug)
    );
  `);
  const insert = db.prepare(
    "INSERT INTO content_index (collection, slug, data, body, content_hash, source_path, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  // Filename is custom-filename.mdx; the compiler stored the frontmatter slug.
  insert.run("docs", "fixture-custom-route", "{}", "", "h1", "content/docs/custom-filename.mdx", 0);
  insert.run(
    "docs",
    "guides/install/quickstart",
    "{}",
    "",
    "h2",
    "content/docs/guides/install/quickstart.mdx",
    0,
  );
  insert.run("pages", "home", "{}", "", "h3", "content/pages/home.mdx", 0);
  insert.run("pages", "why", "{}", "", "h4", "content/pages/why.mdx", 0);
  return db;
}

describe("authoredRoutesFromIndex", () => {
  it("reads slugs the compiler stored, including nested paths", () => {
    const db = seed();
    try {
      const authored = authoredRoutesFromIndex(db);
      assert.deepEqual(authored.docs, ["fixture-custom-route", "guides/install/quickstart"]);
      assert.deepEqual(authored.pages, ["home", "why"]);
    } finally {
      db.close();
    }
  });
});

describe("expectedStaticFiles", () => {
  it("maps a custom slug and a nested doc to the files getStaticPaths would emit", () => {
    const files = expectedStaticFiles({
      docs: ["fixture-custom-route", "guides/install/quickstart"],
      pages: ["home", "why"],
    });
    assert.deepEqual(files, [
      "docs/fixture-custom-route/index.html",
      "docs/fixture-custom-route.md",
      "docs/guides/install/quickstart/index.html",
      "docs/guides/install/quickstart.md",
      "index.html",
      "why/index.html",
    ]);
    assert.equal(
      files.includes("docs/custom-filename/index.html"),
      false,
      "a filename that is not the stored slug must not be checked",
    );
  });
});
