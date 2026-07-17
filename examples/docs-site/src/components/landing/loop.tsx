"use client";

/**
 * §01 — the loop as a bare index. No diagram: five hairline rows, one beat.
 *
 * The rows auto-advance on a 4s beat, wrap through the ghost sixth row
 * (06 · edit again → 01) and start over — the loop is watched running, not
 * illustrated. Hover/focus takes the wheel; leaving hands it back.
 * Reduced-motion users keep manual control.
 */
import { useEffect, useState } from "react";
import { useInView } from "./reveal";

const STAGES = [
  {
    name: "author",
    title: "content/*.mdx",
    body: "MDX in your repo. Frontmatter is data; git is the version history.",
  },
  {
    name: "validate",
    title: "graft compile",
    body: "Every doc validated against your Zod schema. Failures name the file, the field, and the fix.",
  },
  {
    name: "index",
    title: "content_index",
    body: "Atomic hash-diff projection into Postgres. Each compile logs a ChangeSet + git SHA.",
  },
  {
    name: "read",
    title: "typed reads",
    body: "getContent / listContent infer your exact document types. No codegen, ever.",
  },
  {
    name: "render",
    title: "this page",
    body: "Server-rendered from the index. Already live — there was nothing to publish.",
  },
];

/** The sixth beat: not a stage, the wrap-around. */
const RETURN_BEAT = STAGES.length;
const BEATS = STAGES.length + 1;
const BEAT_MS = 4000;

export function Loop() {
  const { ref, inView } = useInView<HTMLDivElement>("-80px");
  const [active, setActive] = useState(0);
  const [engaged, setEngaged] = useState(false);

  useEffect(() => {
    if (!inView || engaged) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setActive((a) => (a + 1) % BEATS), BEAT_MS);
    return () => clearInterval(id);
  }, [inView, engaged]);

  return (
    <div ref={ref} className="loop">
      <div
        className="loop-stages"
        role="tablist"
        aria-label="Stages of the loop"
        onMouseEnter={() => setEngaged(true)}
        onMouseLeave={() => setEngaged(false)}
        onFocusCapture={() => setEngaged(true)}
        onBlurCapture={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setEngaged(false);
        }}
      >
        {STAGES.map((s, i) => (
          <button
            key={s.name}
            type="button"
            role="tab"
            aria-selected={active === i}
            className="loop-stage"
            data-hot={active === i || undefined}
            onMouseEnter={() => setActive(i)}
            onFocus={() => setActive(i)}
            onClick={() => setActive(i)}
          >
            <span className="stage-index">0{i + 1}</span>
            <span className="stage-title">{s.title}</span>
            <span className="stage-body">{s.body}</span>
          </button>
        ))}

        {/* the list refuses to terminate — 06 is 01 */}
        <button
          type="button"
          role="tab"
          aria-selected={active === RETURN_BEAT}
          className="loop-stage loop-stage-return"
          data-hot={active === RETURN_BEAT || undefined}
          onMouseEnter={() => setActive(RETURN_BEAT)}
          onFocus={() => setActive(RETURN_BEAT)}
          onClick={() => setActive(RETURN_BEAT)}
        >
          <span className="stage-index">06</span>
          <span className="stage-title">edit again → 01</span>
          <span className="stage-body">The loop closes. The rendered page feeds your next edit — no publish step to wait for.</span>
        </button>
      </div>
    </div>
  );
}
