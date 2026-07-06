/**
 * The schema gained a required `description` (meta description), so every
 * existing page needs one — the canonical content migration: compile fails
 * per file until this backfills the field. Derives from the tagline when
 * present, else the body's first sentence, else the title.
 *
 * Dry-run with `graft migrate`; execute with `graft migrate --apply`.
 */
import { defineContentMigration } from "@graft/content-migrations";
import { pages } from "../graft.config";

export default defineContentMigration({
  collection: pages,
  description: "Backfill the new required `description` from tagline / first sentence / title",
  transform: ({ data, body }) => {
    const existing = data.description as string | undefined;
    const tagline = data.tagline as string | undefined;
    const firstSentence = body
      .replace(/^#+ .*$/gm, "") // drop headings
      .replace(/[*_`>[\]]/g, "") // drop markdown decoration
      .trim()
      .split(/(?<=\.)\s/)[0];
    return {
      data: {
        ...(data as { title: string }),
        description: existing ?? tagline ?? firstSentence ?? (data.title as string),
      },
    };
  },
});
