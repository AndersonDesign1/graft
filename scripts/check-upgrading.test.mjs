import { test } from "node:test";
import assert from "node:assert/strict";
import { checkUpgrading, countEntries, sectionFor } from "./check-upgrading.mjs";

const breaking = (id) => ({
  id,
  summary: `**BREAKING:** ${id} changed.\n\nMore detail.`,
  releases: [],
});
const plain = (id) => ({ id, summary: `${id} got faster.`, releases: [] });

const page = [
  "# Upgrading",
  "",
  "## 1.0.0-beta.9",
  "",
  "**The Next.js 14 drop.** Why.",
  "",
  "**What to do:** upgrade Next.js.",
  "",
  "## 1.0.0-beta.1 and 1.0.0-beta.2",
  "",
  "**Old change.** Why.",
  "",
  "**What to do:** one.",
  "",
  "**What to do:** two.",
  "",
].join("\n");

test("a release with no breaking changesets needs no entry, even with no section", () => {
  assert.deepEqual(
    checkUpgrading({ version: "1.0.0-beta.10", changesets: [plain("faster")], mdx: page }),
    [],
  );
});

test("three breaking changes with one entry fail, naming each changeset", () => {
  const problems = checkUpgrading({
    version: "1.0.0-beta.9",
    changesets: [
      breaking("exit-codes"),
      breaking("content-lists-files"),
      breaking("drop-next-14"),
      plain("faster"),
    ],
    mdx: page,
  });
  assert.match(
    problems[0],
    /1 "\*\*What to do:\*\*" entry under "## 1\.0\.0-beta\.9", and 1\.0\.0-beta\.9 has 3 breaking/,
  );
  assert.deepEqual(
    problems.filter((line) => line.startsWith("  .changeset/")),
    [
      "  .changeset/exit-codes.md: exit-codes changed.",
      "  .changeset/content-lists-files.md: content-lists-files changed.",
      "  .changeset/drop-next-14.md: drop-next-14 changed.",
    ],
  );
});

test("one entry per breaking change passes", () => {
  assert.deepEqual(
    checkUpgrading({ version: "1.0.0-beta.9", changesets: [breaking("drop-next-14")], mdx: page }),
    [],
  );
});

test("a breaking change with no section for its version fails and names the heading to add", () => {
  const problems = checkUpgrading({
    version: "1.0.0-beta.10",
    changesets: [breaking("exit-codes")],
    mdx: page,
  });
  assert.match(problems[0], /no "## 1\.0\.0-beta\.10" section/);
  assert.match(problems.at(-1), /Add "## 1\.0\.0-beta\.10"/);
});

test("entries in another version's section do not count", () => {
  // beta.1/beta.2 has two entries; beta.9 has one. Counting the whole page
  // would let two breaking changes in beta.9 pass.
  const problems = checkUpgrading({
    version: "1.0.0-beta.9",
    changesets: [breaking("a"), breaking("b")],
    mdx: page,
  });
  assert.equal(problems.length > 0, true);
});

test("a heading that names two versions is found for either, and ends at the next section", () => {
  assert.equal(countEntries(sectionFor(page, "1.0.0-beta.2")), 2);
  assert.equal(countEntries(sectionFor(page, "1.0.0-beta.1")), 2);
  assert.equal(countEntries(sectionFor(page, "1.0.0-beta.9")), 1);
  assert.equal(sectionFor(page, "1.0.0-beta.10"), null);
});
