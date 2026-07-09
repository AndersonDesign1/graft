/**
 * Callout — MDX block (owned code; edit freely).
 *
 * Use in authored MDX bodies:
 *
 *   <Callout type="info">Agents edit this file; git is the version history.</Callout>
 *
 * Wired into the generated `components/mdx-components.ts` map by `graft add`.
 */
import type { ReactNode } from "react";

export type CalloutType = "info" | "warning" | "tip";

export interface CalloutProps {
  type?: CalloutType;
  title?: string;
  children?: ReactNode;
}

const LABELS: Record<CalloutType, string> = {
  info: "Note",
  warning: "Warning",
  tip: "Tip",
};

export function Callout({ type = "info", title, children }: CalloutProps) {
  const label = title ?? LABELS[type];
  return (
    <aside className={`callout callout-${type}`} data-callout={type} role="note">
      <strong className="callout-label">{label}</strong>
      <div className="callout-body">{children}</div>
    </aside>
  );
}
