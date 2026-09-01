/**
 * TierBadge — which tier a feature needs.
 *
 * Graft ships two: a static SQLite artifact with no services at all, and
 * Postgres for functions, branches, approvals and audit. Nearly every page
 * touches the distinction, and the answer was previously a sentence somewhere
 * in the prose that a reader skimming for the API would miss.
 *
 * A badge is the right shape because the question is binary and the reader is
 * usually scanning for it rather than reading toward it.
 *
 * ⚠️ Put it on its own line, never inside a heading. rehype-slug builds a
 * heading's id from its rendered text, so a badge in an `##` changes the
 * anchor: `#quick-start` silently became `#quick-start-` the first time this
 * was tried, breaking the TOC link and any external one. anchor-parity.test.ts
 * catches it, which is how that was found rather than shipped.
 */
export type Tier = "static" | "postgres" | "either";

const COPY = new Map<string, { label: string; title: string }>([
  ["static", { label: "static", title: "Works on the static index. No database, no services." }],
  [
    "postgres",
    {
      label: "needs Postgres",
      title:
        "Needs the Postgres index. Functions, branches, approvals and the audit log are Postgres-tier.",
    },
  ],
  [
    "either",
    { label: "either tier", title: "Works the same on the static index and on Postgres." },
  ],
]);

/**
 * `tier` is typed as a string rather than as `Tier` because that is what
 * arrives: MDX attributes are text the author typed, and the safety gate
 * refuses the `{expressions}` that could make it anything else. Declaring the
 * narrow type would describe a guarantee this component does not have.
 */
export function TierBadge({ tier }: { tier: string }) {
  // An unknown value is the author's typo, and a badge asserting the wrong tier
  // is worse than none: it would answer the reader's question incorrectly.
  const copy = COPY.get(tier);
  if (!copy) return null;

  return (
    <span className={`tier-badge tier-${tier}`} title={copy.title}>
      {copy.label}
    </span>
  );
}
