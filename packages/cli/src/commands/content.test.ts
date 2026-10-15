/**
 * Unit: graft content import's refusals and report. The import itself needs a
 * live database; the database integration suites cover importPublished.
 */
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contentImportCommand, formatImport } from "./content";

const fixtures = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../test/fixtures");

describe("graft content import", () => {
  it("refuses a project whose content is in git", async () => {
    await expect(contentImportCommand({ cwd: join(fixtures, "basic") })).rejects.toMatchObject({
      code: "CONTENT_SOURCE_MISMATCH",
    });
  });

  it("reports what came in and what was left as it is", () => {
    expect(
      formatImport({
        branch: "main",
        imported: ["posts/new.mdx"],
        unchanged: [],
        kept: ["posts/live.mdx"],
        compiled: { added: 1, changed: 0, removed: 0 },
        dryRun: false,
      }),
    ).toEqual([
      'Imported 1 document(s) into the database on branch "main" (0 already up to date).',
      "  posts/new.mdx",
      "Left 1 already published document(s) as they are; edit them in Studio:",
      "  posts/live.mdx",
      "Index: +1 added, ~0 changed, -0 removed.",
    ]);
  });
});
