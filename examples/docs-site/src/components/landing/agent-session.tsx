"use client";

/**
 * A replayed MCP session — the self-teaching loop told honestly: the write
 * fails schema validation, the error carries its own fix, the agent corrects,
 * the compile lands. Error shapes match @graft/contracts GraftError JSON.
 */
import { useInView } from "./reveal";

type Segment = { text: string; cls?: string };
type Message = { role: "agent" | "graft"; meta: string; pre: Segment[] };

const MESSAGES: Message[] = [
  {
    role: "agent",
    meta: "agent → write_content",
    pre: [
      { text: `{ "collection": "pages", "slug": "pricing",\n  "frontmatter": { "title": "Pricing" } }` },
    ],
  },
  {
    role: "graft",
    meta: "graft → error (and the fix rides along)",
    pre: [
      { text: `{ "code": `, cls: "" },
      { text: `"SCHEMA_VALIDATION_FAILED"`, cls: "err" },
      { text: `,\n  "message": "pages/pricing: description is required",\n  `, cls: "" },
      { text: `"fix": "Add a description field — it becomes the page's meta description."`, cls: "fix" },
      { text: ` }`, cls: "" },
    ],
  },
  {
    role: "agent",
    meta: "agent → write_content (corrected, no human in the loop)",
    pre: [
      {
        text: `{ "collection": "pages", "slug": "pricing",\n  "frontmatter": { "title": "Pricing",\n    "description": "Plans for solo builders to fleets." } }`,
      },
    ],
  },
  {
    role: "graft",
    meta: "graft → compiled",
    pre: [
      { text: `validated ✓  projected ✓  `, cls: "fix" },
      { text: `+1 added`, cls: "fix" },
      { text: `  · changeset @ 9f31c2e · audit row written`, cls: "dim" },
    ],
  },
];

export function AgentSession() {
  const { ref, inView } = useInView<HTMLDivElement>("-100px");
  return (
    <div className="agent-frame">
      <div ref={ref} className={`agent-log ${inView ? "in" : ""}`}>
        {MESSAGES.map((m, i) => (
          <div
            key={i}
            className="agent-msg"
            data-role={m.role}
            style={{ "--msg-delay": `${i * 420}ms` } as React.CSSProperties}
          >
            <p className="msg-meta">{m.meta}</p>
            <pre>
              {m.pre.map((seg, j) => (
                <span key={j} className={seg.cls || undefined}>
                  {seg.text}
                </span>
              ))}
            </pre>
          </div>
        ))}
        <div
          className="agent-msg"
          style={{ "--msg-delay": `${MESSAGES.length * 420}ms` } as React.CSSProperties}
        >
          <p>
            Every error code ships an <code>explain_error</code> entry, destructive ops file a
            human approval first, and each invocation writes an audit row with the git SHA. The
            agent is capable; the rails are real.
          </p>
        </div>
      </div>
    </div>
  );
}
