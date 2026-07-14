"use client";

/**
 * Interactive branching toy — the P4 overlay model you can poke, drawn as a
 * graph rather than two lists of rows:
 *
 *   branch = an edge splits off main (one registry row, zero copies)
 *   edit   = a node on the branch goes solid — a copy-on-write override
 *   delete = a node becomes a tombstone (hides the parent on this branch only)
 *   merge  = the edge rejoins main, the override lands, the tombstoned row goes
 *
 * The drawing is the model: inherited rows are *hollow* because nothing was
 * copied — that is the whole point of the overlay, and a list of <li>s cannot
 * say it. Everything animates with stroke-dashoffset and transforms; no library.
 *
 * The SVG is aria-hidden and the same state is published as text for screen
 * readers, so the semantics never live only in a picture.
 */
import { useState } from "react";

type Step = 0 | 1 | 2 | 3 | 4; // none → branched → edited → deleted → merged
type NodeState = "own" | "inherited" | "tombstone";

const STATUS: Record<Step, React.ReactNode> = {
  0: (
    <>
      <b>main</b> has three documents. Create a branch — it costs one registry row, zero copies.
    </>
  ),
  1: (
    <>
      <b>preview</b> exists instantly. The hollow nodes are inherited reads through the overlay —
      nothing was copied.
    </>
  ),
  2: (
    <>
      Editing wrote one overlay row. <b>Leaf wins</b> over the parent; main never noticed.
    </>
  ),
  3: (
    <>
      Deleting wrote a <b>tombstone</b> — it hides the parent row on this branch only.
    </>
  ),
  4: (
    <>
      Merged. Content recompiles from the git merge; data rows move; the branch drops. <b>main</b>{" "}
      carries the new pricing, minus the tombstoned changelog.
    </>
  ),
};

/** Screen-reader truth, so the model isn't only in the drawing. */
function stateOf(step: Step): { lane: string; rows: string[] }[] {
  const preview =
    step >= 1 && step < 4
      ? [
          {
            lane: "preview",
            rows: [
              "pages/home — inherited",
              step >= 2 ? "pages/pricing — override (own row)" : "pages/pricing — inherited",
              step >= 3 ? "pages/changelog — tombstone" : "pages/changelog — inherited",
            ],
          },
        ]
      : [];
  return [
    {
      lane: "main",
      rows:
        step < 4
          ? ["pages/home", "pages/pricing", "pages/changelog"]
          : ["pages/home", "pages/pricing (merged)"],
    },
    ...preview,
  ];
}

const MAIN_Y = 168;
const BRANCH_Y = 62;

function GraphNode({
  x,
  y,
  label,
  state,
  visible,
  delay = 0,
}: {
  x: number;
  y: number;
  label: string;
  state: NodeState;
  visible: boolean;
  delay?: number;
}) {
  return (
    <g
      className="bnode"
      data-state={state}
      data-visible={visible}
      style={{ "--node-delay": `${delay}ms` } as React.CSSProperties}
      transform={`translate(${x} ${y})`}
    >
      <circle className="bnode-dot" r="6" />
      {state === "tombstone" ? (
        <>
          <line className="bnode-x" x1="-4" y1="-4" x2="4" y2="4" />
          <line className="bnode-x" x1="4" y1="-4" x2="-4" y2="4" />
        </>
      ) : null}
      <text className="bnode-label" y={y === MAIN_Y ? 24 : -16} textAnchor="middle">
        {label}
      </text>
    </g>
  );
}

export function BranchingDemo() {
  const [step, setStep] = useState<Step>(0);

  const branched = step >= 1 && step < 4;
  const merging = step >= 4;

  return (
    <div className="branch-demo">
      <div className="branch-controls" role="group" aria-label="Branching demo controls">
        <button type="button" className="branch-cmd" disabled={step !== 0} onClick={() => setStep(1)}>
          graft branch create preview
        </button>
        <button type="button" className="branch-cmd" disabled={step !== 1} onClick={() => setStep(2)}>
          graft compile --branch preview
        </button>
        <button type="button" className="branch-cmd" disabled={step !== 2} onClick={() => setStep(3)}>
          delete_content changelog
        </button>
        <button
          type="button"
          className="branch-cmd"
          data-primary="true"
          disabled={step !== 3}
          onClick={() => setStep(4)}
        >
          graft merge preview --apply
        </button>
        <button type="button" className="branch-cmd" disabled={step === 0} onClick={() => setStep(0)}>
          reset
        </button>
      </div>

      <div className="branch-graph">
        <svg viewBox="0 0 760 230" aria-hidden="true">
          {/* main: always there, the spine */}
          <line className="lane-main" x1="24" y1={MAIN_Y} x2="736" y2={MAIN_Y} />
          <text className="lane-name" x="24" y={MAIN_Y + 44}>
            main
          </text>

          {/* the split — one registry row, zero copies */}
          <path
            className="edge"
            data-on={branched || merging}
            pathLength={1}
            d={`M232 ${MAIN_Y} C280 ${MAIN_Y}, 268 ${BRANCH_Y}, 316 ${BRANCH_Y}`}
          />
          {/* the branch lane itself */}
          <line
            className="edge-line"
            data-on={branched}
            x1="316"
            y1={BRANCH_Y}
            x2="560"
            y2={BRANCH_Y}
          />
          {/* the merge — rejoins main */}
          <path
            className="edge"
            data-on={merging}
            pathLength={1}
            d={`M560 ${BRANCH_Y} C608 ${BRANCH_Y}, 596 ${MAIN_Y}, 644 ${MAIN_Y}`}
          />
          <text className="lane-name" data-on={branched || merging} x="316" y={BRANCH_Y - 40}>
            preview
          </text>

          {/* main rows */}
          <GraphNode x={72} y={MAIN_Y} label="home" state="own" visible />
          <GraphNode x={140} y={MAIN_Y} label="pricing" state="own" visible />
          {/* main's changelog is NEVER tombstoned — a tombstone hides the
              parent on the BRANCH only. main only loses the row at merge. */}
          <GraphNode x={208} y={MAIN_Y} label="changelog" state="own" visible={step < 4} />

          {/* the branch: hollow = inherited, nothing was copied */}
          <GraphNode
            x={356}
            y={BRANCH_Y}
            label="home"
            state="inherited"
            visible={branched}
            delay={80}
          />
          <GraphNode
            x={438}
            y={BRANCH_Y}
            label="pricing"
            state={step >= 2 ? "own" : "inherited"}
            visible={branched}
            delay={160}
          />
          <GraphNode
            x={520}
            y={BRANCH_Y}
            label="changelog"
            state={step >= 3 ? "tombstone" : "inherited"}
            visible={branched}
            delay={240}
          />

          {/* what actually lands on main */}
          <GraphNode
            x={684}
            y={MAIN_Y}
            label="pricing·merged"
            state="own"
            visible={merging}
            delay={420}
          />
        </svg>
      </div>

      <p className="branch-status" aria-live="polite">
        {STATUS[step]}
      </p>

      <ul className="visually-hidden">
        {stateOf(step).map((lane) => (
          <li key={lane.lane}>
            {lane.lane}: {lane.rows.join("; ")}
          </li>
        ))}
      </ul>
    </div>
  );
}
