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

export function Step({ title, children }: StepProps) {
  return (
    <li className="step">
      {title ? <p className="step-title">{title}</p> : null}
      <div className="step-body">{children}</div>
    </li>
  );
}
