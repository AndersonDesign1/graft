/**
 * Callout — the first entry in the docs' MDX component map. Server-rendered
 * to static HTML by renderMdx; no client JS. Styled as a margin note —
 * the editorial voice the bright mark is reserved for.
 */
import type { ReactNode } from "react";

export interface CalloutProps {
  /** Small mono label above the body, e.g. "invariant", "gotcha". */
  label?: string;
  type?: "note" | "warning" | "danger";
  children: ReactNode;
}

export function Callout({ label, type, children }: CalloutProps) {
  const inferredType =
    type ??
    (label && /warning|beta|care|gotcha/i.test(label)
      ? "warning"
      : label && /danger|irreversible|fails|refuse/i.test(label)
        ? "danger"
        : "note");

  const displayLabel =
    label ??
    (inferredType === "warning" ? "Warning" : inferredType === "danger" ? "Caution" : "Note");

  return (
    <aside className={`callout callout-${inferredType}`} data-type={inferredType}>
      <div className="callout-header">
        {inferredType === "warning" && (
          <svg
            className="callout-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        )}
        {inferredType === "danger" && (
          <svg
            className="callout-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        )}
        {inferredType === "note" && (
          <svg
            className="callout-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        )}
        <span className="label callout-label">{displayLabel}</span>
      </div>
      <div className="callout-body">{children}</div>
    </aside>
  );
}
