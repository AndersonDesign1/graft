"use client";

/**
 * The stage — one sticky frame, three beats.
 *
 * The copy scrolls, the frame holds, and crossing a beat swaps what the frame
 * shows. Compile → the agent correcting itself → the types that fall out of
 * the same schema is one argument, so it gets one object.
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
  n: string;
  kicker: string;
  /** what the frame is showing while this beat is active */
  frame: string;
  head: React.ReactNode;
  lede: React.ReactNode;
  /** optional pipeline chips under the lede */
  steps?: string[];
  note?: React.ReactNode;
}

const BEATS: Beat[] = [
  {
    n: "01",
    kicker: "the loop",
    frame: "graft compile — live",
    head: (
      <>
        One loop, <span className="marked">no publish button.</span>
      </>
    ),
    lede: (
      <>
        Edit a file. Run <code>graft compile</code>. Refresh. Validation, projection, and audit
        all land in that pass — publishing is just what correctness looks like.
      </>
    ),
    steps: ["author", "validate", "index", "typed read", "render"],
    note: (
      <>
        <b>If git and Postgres disagree, git wins</b> — recompile. The index is derived state,
        never a second source of truth.
      </>
    ),
  },
  {
    n: "02",
    kicker: "agent-native",
    frame: "mcp exchange — replayed",
    head: (
      <>
        Errors that <span className="marked">teach the fix.</span>
      </>
    ),
    lede: (
      <>
        A cold agent, the MCP endpoint, and error shapes that carry their own fix. Schemas and
        tool descriptions were its only teachers — this is the actual exchange.
      </>
    ),
  },
  {
    n: "03",
    kicker: "typed reads",
    frame: "graft.config.ts → your editor",
    head: (
      <>
        One schema. <span className="marked">Zero codegen.</span>
      </>
    ),
    lede: (
      <>
        The Zod schema in <code>graft.config.ts</code> types the compiler, the SDKs, the
        functions, and the MCP tools — inference end to end.
      </>
    ),
  },
];

export function Stage({ compile }: { compile: TermLine[] }) {
  const [active, setActive] = useState(0);
  // Returning to a beat remounts its demo so the type-out / message cascade
  // plays again instead of sitting finished.
  const [compileRun, setCompileRun] = useState(0);
  const [agentRun, setAgentRun] = useState(0);
  const track = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (active === 0) setCompileRun((r) => r + 1);
    if (active === 1) setAgentRun((r) => r + 1);
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
                <i key={b.n} data-on={i === active} data-done={i < active} />
              ))}
            </div>
            <span className="stage-frame-count">
              {beat.n} / {BEATS.length.toString().padStart(2, "0")}
            </span>
          </div>

          {/* All three share one grid cell, so the frame is as tall as the
              tallest panel and swapping never reflows the page. */}
          <div className="stage-panels">
            <div className="stage-panel" data-active={active === 0} aria-hidden={active !== 0}>
              <Terminal key={compileRun} lines={compile} play={active === 0} />
            </div>
            <div className="stage-panel" data-active={active === 1} aria-hidden={active !== 1}>
              <AgentSession key={agentRun} play={active === 1} />
            </div>
            <div className="stage-panel" data-active={active === 2} aria-hidden={active !== 2}>
              <TypedReads />
            </div>
          </div>
        </div>
      </div>

      <div className="stage-track" ref={track}>
        {BEATS.map((b, i) => (
          <div className="stage-beat" key={b.n} data-beat={i} data-active={i === active}>
            <p className="section-label">
              §{b.n} <em>{b.kicker}</em>
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
