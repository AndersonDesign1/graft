"use client";

/**
 * The loop: MDX → compile → Postgres → typed read → render, drawn as a
 * connector diagram whose stages activate in sequence when scrolled into
 * view (CSS transition-delays; connectors scale in between them).
 */
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
    body: "Server-rendered from the index. The page you are reading is the demo.",
  },
];

export function Pipeline() {
  const { ref, inView } = useInView<HTMLDivElement>("-100px");
  return (
    <>
      <div ref={ref} className={`pipeline ${inView ? "in" : ""}`}>
        {STAGES.map((s, i) => (
          <div key={s.name} className="pipeline-stage">
            <span className="stage-index">0{i + 1}</span>
            <h3>{s.title}</h3>
            <p>{s.body}</p>
          </div>
        ))}
      </div>
      <p className="pipeline-note">
        <b>If git and Postgres ever disagree, git wins</b> — recompile. The index is derived state,
        never a second source of truth.
      </p>
    </>
  );
}
