"use client";

/**
 * §01 — the loop, drawn as one closed circuit, set vertically.
 *
 * The horizontal version left a dead zone beside the copy; this composition
 * fills the row: the five stages are a hairline row list (the tabs) and the
 * circuit stands to the right — a vertical rail the stations hang off, with
 * the return wire sweeping back up ("edit again — the loop closes").
 *
 * Everything is live:
 *   - the circuit draws in, holds, retracts and redraws forever (10s cycle;
 *     the station stagger is an animation-delay, so the phase persists and
 *     the draw/retract runs top-to-bottom as a wave each way)
 *   - a pulse of light laps the closed path endlessly while it is drawn —
 *     down the rail, home up the return wire, no seam
 *   - each row is a tab: hover/focus/click makes its station hot
 *
 * Isometric faces are the rhombus (0,-h)(w,0)(0,h)(-w,0) around a center.
 * The SVG is aria-hidden; the rows carry the same information.
 */
import { useState } from "react";
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
    body: "Server-rendered from the index. The page you are reading is the demo.",
  },
];

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

      {/* the light: one dash lapping the closed path while the circuit holds */}
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

  return (
    <div ref={ref} className={`loop ${inView ? "in" : ""}`}>
      <div className="loop-stages" role="tablist" aria-label="Stages of the loop">
        {STAGES.map((s, i) => (
          <button
            key={s.name}
            type="button"
            role="tab"
            aria-selected={active === i}
            className="loop-stage"
            data-hot={active === i || undefined}
            style={{ "--i": i } as React.CSSProperties}
            onMouseEnter={() => setActive(i)}
            onFocus={() => setActive(i)}
            onClick={() => setActive(i)}
          >
            <span className="stage-index">0{i + 1}</span>
            <span className="stage-title">{s.title}</span>
            <span className="stage-body">{s.body}</span>
          </button>
        ))}
      </div>

      <Stations active={active} />
    </div>
  );
}
