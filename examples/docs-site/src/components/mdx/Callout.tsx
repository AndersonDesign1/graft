/**
 * Callout — the first entry in the docs' MDX component map. Server-rendered
 * to static HTML by renderMdx; no client JS. Styled as a red-pen margin
 * note — the editorial voice the vermilion accent is reserved for.
 */
import type { ReactNode } from "react";

export interface CalloutProps {
  /** Small mono label above the body, e.g. "invariant", "gotcha". */
  label?: string;
  children: ReactNode;
}

export function Callout({ label = "note", children }: CalloutProps) {
  return (
    <aside className="callout">
      <span className="label callout-label">{label}</span>
      <div className="callout-body">{children}</div>
    </aside>
  );
}
