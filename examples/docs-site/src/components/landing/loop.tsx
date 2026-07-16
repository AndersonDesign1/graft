"use client";

/**
 * §01 — the loop, drawn as one closed circuit.
 *
 * The five stages used to be five bordered cards; a bordered box with a title
 * and a paragraph is the most generic object in web design. Now the section is
 * a single hand-authored schematic: five isometric line-art stations standing
 * on one rail — mdx plate → validation gate → index rows → typed read →
 * rendered page — with a return wire underneath, because the whole claim is
 * that this is a *loop*: render feeds back into editing.
 *
 * Everything is live:
 *   - the circuit draws itself on entry (pathLength=1 + dashoffset transition)
 *   - a pulse of light circles it continuously: forward along the rail, back
 *     along the return wire (a gradient rect masked by the wire path — the
 *     mask *is* the line, so the light appears to travel through it)
 *   - each station is a tab: hover/focus/click makes it hot (strokes brighten,
 *     its detail draws) and the CLI strip below types that stage's real
 *     command and output
 *
 * Isometric faces are the rhombus (0,-h)(w,0)(0,h)(-w,0) around a center —
 * everything on a consistent 2:1 grid, no icon set, no 3D library.
 * The SVG is aria-hidden; the tabs + CLI strip carry the same information.
 */
import { useCallback, useState } from "react";
import type { TermLine } from "../../lib/highlight";
import { CliStrip } from "./cli-strip";
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

/** Station centers sit at 10/30/50/70/90% of the 960 canvas — exactly the
 *  centers of the five text columns below, so glyph and caption align. */
const CX = [96, 288, 480, 672, 864];
const RAIL_Y = 168;

function Stations({ active }: { active: number }) {
  const hot = (i: number) => (active === i ? "true" : undefined);
  return (
    <svg viewBox="0 90 960 172" aria-hidden="true" className="loop-svg">
      <defs>
        <linearGradient id="loop-grad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--mark)" stopOpacity="0" />
          <stop offset="50%" stopColor="var(--mark)" stopOpacity="1" />
          <stop offset="100%" stopColor="var(--mark)" stopOpacity="0" />
        </linearGradient>
        {/* the light runs *through* the wires: mask = the line itself */}
        <mask id="loop-rail-mask">
          <path d={`M${CX[0]} ${RAIL_Y} H${CX[4]}`} stroke="#fff" strokeWidth="1.5" />
        </mask>
        <mask id="loop-ret-mask">
          <path
            d={`M${CX[4]} ${RAIL_Y} C926 ${RAIL_Y} 926 252 ${CX[4]} 252 L192 252 C130 252 130 ${RAIL_Y} ${CX[0]} ${RAIL_Y}`}
            stroke="#fff"
            strokeWidth="1.5"
            fill="none"
          />
        </mask>
      </defs>

      {/* the rail every station stands on, and the return wire that closes
          the circuit — render feeds back into editing */}
      <path className="ln rail drawn" pathLength={1} d={`M${CX[0]} ${RAIL_Y} H${CX[4]}`} />
      <path
        className="ln rail ret drawn"
        pathLength={1}
        d={`M${CX[4]} ${RAIL_Y} C926 ${RAIL_Y} 926 252 ${CX[4]} 252 L192 252 C130 252 130 ${RAIL_Y} ${CX[0]} ${RAIL_Y}`}
      />
      <text className="ret-label" x="480" y="244" textAnchor="middle">
        edit again — the loop closes
      </text>

      {/* the light, circling: forward along the rail… */}
      <rect
        className="pulse pulse-fwd"
        x="-170"
        y="158"
        width="170"
        height="20"
        fill="url(#loop-grad)"
        mask="url(#loop-rail-mask)"
      />
      {/* …and home along the return wire */}
      <rect
        className="pulse pulse-ret"
        x="960"
        y="150"
        width="170"
        height="116"
        fill="url(#loop-grad)"
        mask="url(#loop-ret-mask)"
      />

      {/* 01 · author — one MDX plate */}
      <g className="station" data-hot={hot(0)} style={{ "--d": "150ms" } as React.CSSProperties}>
        <path className="ln drawn" pathLength={1} d={face(96, 136, 46, 24)} />
        <path className="ln dim drawn" pathLength={1} d="M80 128 H112 M86 120 H106 M80 144 H112" />
        <path className="ln drawn" pathLength={1} d="M96 160 V168" />
      </g>

      {/* 02 · validate — the gate; the check draws when hot */}
      <g className="station" data-hot={hot(1)} style={{ "--d": "300ms" } as React.CSSProperties}>
        <path className="ln drawn" pathLength={1} d={face(288, 134, 26, 26)} />
        <path className="ln check" pathLength={1} d="M278 136 L286 144 L300 126" />
        <path className="ln drawn" pathLength={1} d="M288 160 V168" />
      </g>

      {/* 03 · index — projected rows */}
      <g className="station" data-hot={hot(2)} style={{ "--d": "450ms" } as React.CSSProperties}>
        <path className="ln row drawn" pathLength={1} d={face(480, 114, 44, 15)} />
        <path className="ln row drawn" pathLength={1} d={face(480, 130, 44, 15)} />
        <path className="ln row drawn" pathLength={1} d={face(480, 146, 44, 15)} />
        <path className="ln drawn" pathLength={1} d="M480 161 V168" />
      </g>

      {/* 04 · read — a document inside type brackets */}
      <g className="station" data-hot={hot(3)} style={{ "--d": "600ms" } as React.CSSProperties}>
        <path className="ln drawn" pathLength={1} d="M652 116 L636 134 L652 152" />
        <path className="ln drawn" pathLength={1} d="M692 116 L708 134 L692 152" />
        <path className="token drawn" pathLength={1} d={face(672, 134, 13, 9)} />
        <path className="ln drawn" pathLength={1} d="M672 143 V168" />
      </g>

      {/* 05 · render — the page, h1 lit */}
      <g className="station" data-hot={hot(4)} style={{ "--d": "750ms" } as React.CSSProperties}>
        <path className="ln drawn" pathLength={1} d={face(864, 134, 50, 26)} />
        <path className="ln h1bar drawn" pathLength={1} d="M840 128 H890" />
        <path className="ln dim drawn" pathLength={1} d="M844 140 H880" />
        <path className="ln drawn" pathLength={1} d="M864 160 V168" />
      </g>
    </svg>
  );
}

export function Loop({ samples }: { samples: TermLine[][] }) {
  const { ref, inView } = useInView<HTMLDivElement>("-80px");
  const [active, setActive] = useState(0);
  const [runKey, setRunKey] = useState(0);

  const activate = useCallback((i: number) => {
    setActive((prev) => {
      if (prev !== i) setRunKey((k) => k + 1);
      return i;
    });
  }, []);

  return (
    <div ref={ref} className={`loop ${inView ? "in" : ""}`}>
      <Stations active={active} />

      <div className="loop-stages" role="tablist" aria-label="Stages of the loop">
        {STAGES.map((s, i) => (
          <button
            key={s.name}
            type="button"
            role="tab"
            aria-selected={active === i}
            className="loop-stage"
            data-hot={active === i || undefined}
            onMouseEnter={() => activate(i)}
            onFocus={() => activate(i)}
            onClick={() => activate(i)}
          >
            <span className="stage-index">0{i + 1}</span>
            <span className="stage-title">{s.title}</span>
            <span className="stage-body">{s.body}</span>
          </button>
        ))}
      </div>

      <div className="loop-cli">
        <span className="loop-cli-label">
          0{active + 1} · {STAGES[active]!.name}
        </span>
        <CliStrip lines={samples[active] ?? []} runKey={runKey} play={inView} />
      </div>

      <p className="pipeline-note">
        <b>If git and Postgres ever disagree, git wins</b> — recompile. The index is derived state,
        never a second source of truth.
      </p>
    </div>
  );
}
