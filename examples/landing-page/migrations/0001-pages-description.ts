/**
 * The schema gained a required `description` (meta description), so every
 * existing page needs one — the canonical content migration: compile fails
 * per file until this backfills the field. Derives from the tagline when
 * present, else the body's first sentence, else the title.
 *
 * Dry-run with `graft migrate`; execute with `graft migrate --apply`.
 */
import type { DocumentData } from "@usegraft/core";
import { defineContentMigration } from "@usegraft/content-migrations";
import { pages } from "../graft.config";

export default defineContentMigration({
  collection: pages,
  description: "Backfill the new required `description` from tagline / first sentence / title",
  transform: ({ data, body }) => {
    const existing = typeof data.description === "string" ? data.description : undefined;
    const tagline = typeof data.tagline === "string" ? data.tagline : undefined;
    const title = typeof data.title === "string" ? data.title : "";
    const firstSentence = body
      .replace(/^#+ .*$/gm, "") // drop headings
      .replace(/[*_`>[\]]/g, "") // drop markdown decoration
      .trim()
      .split(/(?<=\.)\s/)[0];
    // ContentMigrationDoc.data is the OLD untyped shape; assert the NEW shape
    // after backfill (validated at apply time against the collection schema).
    return {
      data: {
        ...data,
        // `??` only falls through on null/undefined, so an empty string short-
        // circuited the chain and the documented "else the title" fallback was
        // never reached — body-less pages were backfilled with description: "".
        // Pick the first value that is actually present.
        description:
          [existing, tagline, firstSentence, title].find(
            (candidate) => typeof candidate === "string" && candidate.trim() !== "",
          ) ?? "",
      } as DocumentData<typeof pages>,
    };
  },
});
