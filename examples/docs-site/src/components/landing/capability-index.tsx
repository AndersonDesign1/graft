"use client";

/**
 * §06 — the capability index. A dense list of everything the runtime can do,
 * each row backed by its command's *real* output (verbatim strings from
 * @graft/cli and the functions handler — nothing staged). Select a row and
 * the panel types the evidence.
 *
 * The pattern is a feature index: rows on one side, one live panel on the
 * other. No cards — rows are hairline-separated, the panel is a bare pre
 * under a label, same interaction language as the loop's stations.
 */
import { useCallback, useState } from "react";
import type { TermLine } from "../../lib/highlight";
import { CliStrip } from "./cli-strip";
import { useInView } from "./reveal";

export interface Capability {
  name: string;
  tag: string;
  label: string;
  note: string;
}

/** Row copy lives here; the matching samples are tokenized in index.astro
 *  (same order) so shiki runs at build time, never on the client. */
export const CAPABILITIES: Capability[] = [
  {
    name: "mcp",
    tag: "the operator surface",
    label: ".mcp.json",
    note: "Register once; every agent that opens the repo gets the server — reads from git, writes that validate, errors that carry their own fix.",
  },
  {
    name: "branch",
    tag: "copy-on-write previews",
    label: "graft branch create",
    note: "Instant, because nothing is copied — reads overlay the parent until the branch writes. --backend neon forks a physical database instead.",
  },
  {
    name: "merge",
    tag: "dry-run first, always",
    label: "graft merge",
    note: "A merge is a replay, not a diff guess: ledger entries, then data rows, then a recompile. Nothing touches the target without --apply.",
  },
  {
    name: "approvals",
    tag: "humans gate destruction",
    label: "graft approvals",
    note: "Destructive calls park as pending approvals. The runtime role can request and consume them — only a human can decide.",
  },
  {
    name: "assets",
    tag: "binaries, referenced",
    label: "graft asset put",
    note: "The upload prints the frontmatter to paste — an agent's add-image path is upload, paste, compile.",
  },
  {
    name: "functions",
    tag: "typed writes over HTTP",
    label: "POST /api/fn/submitContact",
    note: "Zod-validated input, a data_records row, an audit entry — the landing page's own contact form is this exact call.",
  },
  {
    name: "search",
    tag: "FTS inside the index",
    label: "content_index.search",
    note: "One weighted tsvector per document: slug beats frontmatter beats body. The docs search on this site queries it.",
  },
  {
    name: "serve",
    tag: "the runtime, whole",
    label: "graft serve",
    note: "The same Web-standard handlers you can mount in Next, Astro, or SvelteKit — or run whole, as one container.",
  },
];

export function CapabilityIndex({ samples }: { samples: TermLine[][] }) {
  const { ref, inView } = useInView<HTMLDivElement>("-80px");
  const [active, setActive] = useState(0);
  const [runKey, setRunKey] = useState(0);

  const activate = useCallback((i: number) => {
    setActive((prev) => {
      if (prev !== i) setRunKey((k) => k + 1);
      return i;
    });
  }, []);

  const current = CAPABILITIES[active]!;

  return (
    <div ref={ref} className={`capdex ${inView ? "in" : ""}`}>
      <div className="capdex-list" role="tablist" aria-label="Runtime capabilities">
        {CAPABILITIES.map((c, i) => (
          <button
            key={c.name}
            type="button"
            role="tab"
            aria-selected={active === i}
            className="capdex-row"
            data-hot={active === i || undefined}
            style={{ "--i": i } as React.CSSProperties}
            onMouseEnter={() => activate(i)}
            onFocus={() => activate(i)}
            onClick={() => activate(i)}
          >
            <span className="capdex-num">0{i + 1}</span>
            <span className="capdex-name">{c.name}</span>
            <span className="capdex-tag">{c.tag}</span>
          </button>
        ))}
      </div>

      <div className="capdex-panel">
        <span className="capdex-label">
          0{active + 1} · {current.label}
        </span>
        <CliStrip lines={samples[active] ?? []} runKey={runKey} play={inView} />
        <p className="capdex-note">{current.note}</p>
      </div>
    </div>
  );
}
