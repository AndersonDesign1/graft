"use client";

/**
 * A replayed MCP exchange — not another terminal card.
 *
 * Shape: call/response ribbons weaving left (agent) and right (graft).
 * Packet outlines are SVG polygons so the chamfer gets a real stroke —
 * CSS borders cannot follow clip-path. The outline SVG sits above the
 * text layer so nothing covers the slant.
 */
import { useEffect, useState } from "react";
import { useInView } from "./reveal";

type Segment = { text: string; cls?: string };

type Turn = {
  role: "agent" | "graft";
  tool: string;
  kind?: "error" | "ok";
  body: Segment[];
};

/**
 * viewBox 0 0 100 100 — stretched with preserveAspectRatio=none.
 * Inset ~1 unit so the stroke stays inside the box.
 */
const PACKET_POINTS = {
  agent: "1,1 89,1 99,14 99,99 1,99",
  graft: "10,1 99,1 99,99 1,99 1,14",
} as const;

const TURNS: Turn[] = [
  {
    role: "agent",
    tool: "write_content",
    body: [
      {
        text: `{ "collection": "pages", "slug": "pricing",\n  "frontmatter": { "title": "Pricing" } }`,
      },
    ],
  },
  {
    role: "graft",
    tool: "SCHEMA_VALIDATION_FAILED",
    kind: "error",
    body: [
      { text: `"message": "description is required"\n`, cls: "" },
      {
        text: `"fix": "Add description —\n  becomes the meta description."`,
        cls: "ok",
      },
    ],
  },
  {
    role: "agent",
    tool: "write_content · corrected",
    body: [
      {
        text: `{ …frontmatter: {\n    title,\n    description: "Plans for solo builders…"\n  } }`,
      },
    ],
  },
  {
    role: "graft",
    tool: "compiled",
    kind: "ok",
    body: [
      { text: `validated ✓  projected ✓\n`, cls: "ok" },
      { text: `+1 added`, cls: "ok" },
      { text: `  · @ 9f31c2e`, cls: "dim" },
    ],
  },
];

function PacketShape({ role, mode }: { role: "agent" | "graft"; mode: "fill" | "stroke" }) {
  return (
    <svg
      className={`mcp-turn-shape mcp-turn-shape-${mode}`}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polygon points={PACKET_POINTS[role]} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function AgentSession({
  play = false,
}: {
  play?: boolean;
} = {}) {
  const { ref, inView } = useInView<HTMLDivElement>("-100px");
  const armed = play || inView;
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!armed) {
      setShown(false);
      return;
    }
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, [armed]);

  return (
    <div
      ref={ref}
      className={`mcp-exchange ${shown ? "in" : ""}`}
      aria-label="Replayed MCP exchange"
    >
      <div className="mcp-spine" aria-hidden="true" />
      {TURNS.map((turn, i) => (
        <article
          key={i}
          className="mcp-turn"
          data-role={turn.role}
          data-kind={turn.kind || undefined}
          style={{ "--turn-delay": `${i * 280}ms` } as React.CSSProperties}
        >
          <div className="mcp-ribbon">
            <header className="mcp-turn-head">
              <span className="mcp-who">{turn.role}</span>
              <span className="mcp-tool">{turn.tool}</span>
            </header>
            <div className="mcp-turn-body">
              <PacketShape role={turn.role} mode="fill" />
              <pre className="mcp-turn-fill">
                {turn.body.map((seg, j) => (
                  <span key={j} className={seg.cls || undefined}>
                    {seg.text}
                  </span>
                ))}
              </pre>
              <PacketShape role={turn.role} mode="stroke" />
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
