/**
 * Steps — an ordered procedure where each step holds real content.
 *
 * A markdown list gets you numbering, and then fights you the moment a step
 * needs a fenced block or a callout inside it: the indentation rules for block
 * content in a list item are the thing every docs author gets wrong at least
 * once. `<Step>` takes any children and the numbering comes from a CSS counter,
 * so the author writes prose and code at the top level of the step.
 *
 * The number is generated rather than typed, which means inserting a step in
 * the middle does not renumber anything by hand.
 */
import type { ReactNode } from "react";

export function Steps({ children }: { children: ReactNode }) {
  return <ol className="steps">{children}</ol>;
}

export interface StepProps {
  /** The step's own heading. Optional: a step can be prose alone. */
  title?: string;
  children: ReactNode;
}

/** Slug for a step title's deep-link id. Same rules as the heading slugger
 *  (lowercase, runs of non-alphanumerics to one dash), namespaced so a step
 *  can never collide with a real heading id. */
function stepSlug(title: string): string {
  return `step-${title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")}`;
}

export function Step({ title, children }: StepProps) {
  const id = title ? stepSlug(title) : undefined;
  return (
    <li className="step">
      {title ? (
        <p className="step-title" id={id}>
          {title}
          <a className="step-anchor" href={`#${id}`} aria-label={`Link to step: ${title}`}>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
          </a>
        </p>
      ) : null}
      <div className="step-body">{children}</div>
    </li>
  );
}
