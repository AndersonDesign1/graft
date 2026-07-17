"use client";

/**
 * §01 — the loop, drawn as one closed circuit, set vertically.
 *
 * The section is the claim, running: the circuit draws itself ONCE when it
 * scrolls into view and then holds — the loop is a machine, and a machine
 * that flickers reads as broken — while a pulse of light laps the closed
 * path forever. The stage rows auto-advance on the same beat (one stage per
 * lap of the light), so the loop operates itself with no input: that is the
 * "no publish button" argument, acted out. Hover/focus takes the wheel;
 * leaving hands it back.
 *
 * The list refuses to terminate: a sixth ghost row — 06 · edit again — goes
 * hot after 05, lights the return wire, and wraps back to 01. And where
 * every other CMS puts its publish button, the wire just routes past a
 * crossed-out [ publish ].
 *
 * Isometric faces are the rhombus (0,-h)(w,0)(0,h)(-w,0) around a center.
 * The SVG is aria-hidden; the rows carry the same information.
 */
import { useEffect, useState } from "react";
import { useInView } from "./reveal";

/** One isometric face (rhombus) centered at cx,cy. */
const face = (cx: number, cy: number, w: number, h: number) =>
  `M${cx} ${cy - h} L${cx + w} ${cy} L${cx} ${cy + h} L${cx - w} ${cy} Z`;

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

/** One beat per lap of the light — keep in sync with the loop-lap duration. */
const LAP_MS = 4000;

/** Station centers down the rail. */
const CY = [70, 230, 390, 550, 710];
const RAIL_X = 120;

/** The full circuit as one path whose end point *is* its start point, so a
 *  dash cycling its offset laps it without a seam: down the rail, back up
 *  the return wire, home. */
const CIRCUIT = `M${RAIL_X} ${CY[0]} V${CY[4]} C196 710 224 682 224 622 L224 158 C224 98 196 70 ${RAIL_X} ${CY[0]}`;

function Stations({ active }: { active: number }) {
  const hot = (i: number) => (active === i ? "true" : undefined);
  return (
    <svg viewBox="0 40 270 706" aria-hidden="true" className="loop-svg">
      {/* the rail the stations hang off, and the return wire that closes the
          circuit — render feeds back into editing */}
      <path className="ln rail drawn" pathLength={1} d={`M${RAIL_X} ${CY[0]} V${CY[4]}`} />
      <path
        className="ln rail ret drawn"
        pathLength={1}
        d={`M${RAIL_X} ${CY[4]} C196 710 224 682 224 622 L224 158 C224 98 196 70 ${RAIL_X} ${CY[0]}`}
      />
      <text className="ret-label" transform="rotate(-90 252 390)" x="252" y="390" textAnchor="middle">
        edit again — the loop closes
      </text>

      {/* where every other CMS puts its publish button, the wire routes past;
          the strike draws itself in after the circuit settles */}
      <text className="no-publish" x="176" y="742" textAnchor="middle">
        [ publish ]
      </text>
      <path
        className="no-publish-strike drawn"
        pathLength={1}
        style={{ "--d": "2400ms" } as React.CSSProperties}
        d="M146 745 L206 738"
      />

      {/* the light: one dash lapping the closed path forever */}
      <path className="flow flow-halo" pathLength={1} d={CIRCUIT} />
      <path className="flow" pathLength={1} d={CIRCUIT} />

      {/* 01 · author — one MDX plate */}
      <g className="station" data-hot={hot(0)} style={{ "--d": "150ms" } as React.CSSProperties}>
        <path className="ln drawn" pathLength={1} d={face(64, 70, 46, 24)} />
        <path className="ln dim drawn" pathLength={1} d="M48 62 H80 M54 54 H74 M48 78 H80" />
        <path className="ln drawn" pathLength={1} d="M110 70 H120" />
      </g>

      {/* 02 · validate — the gate; the check draws when hot */}
      <g className="station" data-hot={hot(1)} style={{ "--d": "300ms" } as React.CSSProperties}>
        <path className="ln drawn" pathLength={1} d={face(64, 230, 26, 26)} />
        <path className="ln check" pathLength={1} d="M54 232 L62 240 L76 222" />
        <path className="ln drawn" pathLength={1} d="M90 230 H120" />
      </g>

      {/* 03 · index — projected rows */}
      <g className="station" data-hot={hot(2)} style={{ "--d": "450ms" } as React.CSSProperties}>
        <path className="ln row drawn" pathLength={1} d={face(64, 374, 44, 15)} />
        <path className="ln row drawn" pathLength={1} d={face(64, 390, 44, 15)} />
        <path className="ln row drawn" pathLength={1} d={face(64, 406, 44, 15)} />
        <path className="ln drawn" pathLength={1} d="M108 390 H120" />
      </g>

      {/* 04 · read — a document inside type brackets */}
      <g className="station" data-hot={hot(3)} style={{ "--d": "600ms" } as React.CSSProperties}>
        <path className="ln drawn" pathLength={1} d="M44 532 L28 550 L44 568" />
        <path className="ln drawn" pathLength={1} d="M84 532 L100 550 L84 568" />
        <path className="token drawn" pathLength={1} d={face(64, 550, 13, 9)} />
        <path className="ln drawn" pathLength={1} d="M77 550 H120" />
      </g>

      {/* 05 · render — the page, h1 lit */}
      <g className="station" data-hot={hot(4)} style={{ "--d": "750ms" } as React.CSSProperties}>
        <path className="ln drawn" pathLength={1} d={face(64, 710, 50, 26)} />
        <path className="ln h1bar drawn" pathLength={1} d="M40 704 H90" />
        <path className="ln dim drawn" pathLength={1} d="M44 716 H80" />
        <path className="ln drawn" pathLength={1} d="M114 710 H120" />
      </g>
    </svg>
  );
}

export function Loop() {
  const { ref, inView } = useInView<HTMLDivElement>("-80px");
  const [active, setActive] = useState(0);
  const [engaged, setEngaged] = useState(false);

  // The loop operates itself: one beat per lap of the light, wrapping through
  // the return beat back to 01 — the closure is watched, not asserted.
  // Interaction pauses the clock; reduced-motion users keep manual control.
  useEffect(() => {
    if (!inView || engaged) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setActive((a) => (a + 1) % BEATS), LAP_MS);
    return () => clearInterval(id);
  }, [inView, engaged]);

  return (
    <div ref={ref} className={`loop ${inView ? "in" : ""}`} data-ret={active === RETURN_BEAT || undefined}>
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
          <span className="stage-body">The loop closes. The rendered page feeds your next edit — there is no publish step to wait for.</span>
        </button>
      </div>

      <Stations active={active} />
    </div>
  );
}
