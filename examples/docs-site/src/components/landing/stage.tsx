"use client";

/**
 * The stage — one sticky frame, four beats.
 *
 * The copy scrolls, the frame holds, and crossing a beat swaps what the frame
 * shows. The agent locked out of a dashboard → the compile loop that answers it
 * → the types that fall out of the same schema → self-host is one argument, so
 * it gets one object.
 *
 * State is scroll position, nothing else. A single IntersectionObserver with a
 * middle band (`-45%` top and bottom) leaves at most one beat intersecting at
 * a time — whichever is crossing the optical center of the viewport is the
 * active one. No scroll listener, no wheel math, no pinning: the page scrolls
 * exactly like a document.
 *
 * Layout inverts rather than degrades. Desktop: copy left, frame sticky right,
 * vertically centered. Narrow: one column with the frame sticky at the *top*
 * under the nav and the beats scrolling beneath it — same swap, same DOM, no
 * duplicated panels and no JS breakpoint.
 */
import { useEffect, useRef, useState } from "react";
import type { TermLine } from "../../lib/highlight";
import { AgentSession } from "./agent-session";
import { Terminal } from "./terminal";
import { TypedReads } from "./typed-reads";

interface Beat {
  /**
   * Ties a beat to the panel it drives and to its replay counter.
   *
   * Order used to live in three places at once — this array, a hardcoded run of
   * panel indices, and an effect matching `active === 0` to a specific demo.
   * Reordering the argument meant editing all three in step, and getting it
   * wrong showed the wrong demo under the right copy. Now order lives here,
   * and the number is derived from position rather than written down.
   */
  id: "mcp" | "loop" | "types" | "selfhost";
  kicker: string;
  /** what the frame is showing while this beat is active */
  frame: string;
  head: React.ReactNode;
  lede: React.ReactNode;
  /** optional pipeline chips under the lede */
  steps?: string[];
  note?: React.ReactNode;
}

/** Displayed beat number. Derived from position so a reorder renumbers itself. */
const num = (i: number): string => String(i + 1).padStart(2, "0");

// The problem leads. The hero states the claim and does not argue it, so the
// first beat is the argument: why a dashboard is the wrong shape for the thing
// doing most of the edits. The loop then answers it. Running the loop first
// showed the solution to a problem the reader had not been given yet.
const BEATS: Beat[] = [
  {
    id: "mcp",
    kicker: "no dashboard trap",
    frame: "mcp exchange — replayed",
    head: (
      <>
        Dashboards <span className="marked">lock agents out.</span>
      </>
    ),
    lede: (
      <>
        A mouse UI is a dead end for an agent. Graft speaks MCP and CLI with errors that carry their
        own <code>fix</code>. This replay is a real cold exchange.
      </>
    ),
  },
  {
    id: "loop",
    kicker: "the loop",
    frame: "graft compile — live",
    head: (
      <>
        Edit a file. <span className="marked">Compile. Refresh.</span>
      </>
    ),
    lede: (
      <>
        No publish button and no admin write path. You or your agent change MDX;{" "}
        <code>graft compile</code> validates it and updates the Postgres index.
      </>
    ),
    steps: ["author", "validate", "index", "typed read", "render"],
    note: (
      <>
        <b>If git and Postgres disagree, recompile.</b> Git wins. The index is derived state.
      </>
    ),
  },
  {
    id: "types",
    kicker: "typed reads",
    frame: "graft.config.ts → your editor",
    head: (
      <>
        One schema. <span className="marked">No codegen.</span>
      </>
    ),
    lede: (
      <>
        The Zod schema in <code>graft.config.ts</code> types the compiler, the SDKs, the functions,
        and the MCP tools.
      </>
    ),
  },
  {
    id: "selfhost",
    kicker: "self-host",
    frame: "docker run / graft serve",
    head: (
      <>
        Your Postgres. <span className="marked">Your box.</span>
      </>
    ),
    lede: (
      <>
        Open source and self-hostable. One container, or <code>graft serve</code> against your
        database. Same handler bytes either way. No Graft cloud required.
      </>
    ),
    note: (
      <>
        <b>Deploy anywhere.</b> Railway, Fly, VPS, or embed the handlers in Next, Astro, SvelteKit,
        TanStack Start, or React Router.
      </>
    ),
  },
];

export function Stage({ compile, selfhost }: { compile: TermLine[]; selfhost: TermLine[] }) {
  const [active, setActive] = useState(0);
  // Returning to a beat remounts its demo so the type-out / message cascade
  // plays again instead of sitting finished. Keyed by beat id rather than by
  // index, so the counters cannot be pointed at the wrong demo by a reorder.
  const [runs, setRuns] = useState<Partial<Record<Beat["id"], number>>>({});
  const track = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const id = BEATS[active]?.id;
    // "types" is static — nothing to replay, so remounting it would only throw
    // away the hover state someone is using.
    if (!id || id === "types") return;
    setRuns((r) => ({ ...r, [id]: (r[id] ?? 0) + 1 }));
  }, [active]);

  useEffect(() => {
    const el = track.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const beats = Array.from(el.querySelectorAll<HTMLElement>("[data-beat]"));

    // Pick whichever beat's center is nearest the viewport's optical middle.
    // A thin "is intersecting" band alone can stick on the wrong beat when
    // scrolling back up (exit events are ignored, and a re-enter can miss).
    const pick = () => {
      const mid = window.innerHeight * 0.5;
      let best = 0;
      let bestDist = Infinity;
      for (const beat of beats) {
        const r = beat.getBoundingClientRect();
        const dist = Math.abs((r.top + r.bottom) / 2 - mid);
        if (dist < bestDist) {
          bestDist = dist;
          best = Number(beat.dataset.beat);
        }
      }
      if (!Number.isNaN(best)) setActive(best);
    };

    const io = new IntersectionObserver(pick, {
      threshold: [0, 0.15, 0.35, 0.5, 0.65, 0.85, 1],
    });
    for (const beat of beats) io.observe(beat);
    pick();
    return () => io.disconnect();
  }, []);

  const beat = BEATS[active]!;

  return (
    <section className="stage" id="how" aria-label="How Graft works">
      <div className="stage-frame-col">
        <div className="stage-frame">
          <div className="stage-frame-bar">
            <span className="stage-frame-label" aria-live="polite">
              {beat.frame}
            </span>
            <div className="stage-frame-progress" aria-hidden="true">
              {BEATS.map((b, i) => (
                <i key={b.id} data-on={i === active} data-done={i < active} />
              ))}
            </div>
            <span className="stage-frame-count">
              {num(active)} / {num(BEATS.length - 1)}
            </span>
          </div>

          {/* All panels share one grid cell, so the frame is as tall as the
              tallest panel and swapping never reflows the page. */}
          <div className="stage-panels">
            {BEATS.map((b, i) => {
              const on = active === i;
              const run = runs[b.id] ?? 0;
              return (
                <div className="stage-panel" key={b.id} data-active={on} aria-hidden={!on}>
                  {b.id === "mcp" ? <AgentSession key={run} play={on} /> : null}
                  {b.id === "loop" ? <Terminal key={run} lines={compile} play={on} /> : null}
                  {b.id === "types" ? <TypedReads /> : null}
                  {b.id === "selfhost" ? <Terminal key={run} lines={selfhost} play={on} /> : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="stage-track" ref={track}>
        {BEATS.map((b, i) => (
          <div className="stage-beat" key={b.id} data-beat={i} data-active={i === active}>
            <p className="section-label">
              §{num(i)} <em>{b.kicker}</em>
            </p>
            <h2>{b.head}</h2>
            <p className="section-lede">{b.lede}</p>
            {b.steps ? (
              <ol className="stage-pipe" aria-label="Compile loop">
                {b.steps.map((step, j) => (
                  <li key={step}>
                    <span>{step}</span>
                    {j < b.steps!.length - 1 ? (
                      <span className="stage-pipe-sep" aria-hidden="true">
                        →
                      </span>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : null}
            {b.note ? <p className="pipeline-note">{b.note}</p> : null}
          </div>
        ))}
      </div>
    </section>
  );
}
