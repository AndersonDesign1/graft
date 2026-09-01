/**
 * Tabs — CSS only, because the prose around them ships no JavaScript.
 *
 * `renderMdx` turns authored bodies into static HTML on the server. A tab strip
 * that needed a React island would make every page carrying one pay for a
 * hydration boundary, to switch between two install commands.
 *
 * So the switching is a radio group: one hidden input per tab, labels that
 * point at them, and sibling selectors in fumadocs.css that show the matching
 * panel. Radios also happen to give the right keyboard model for free — arrow
 * keys move between tabs, which is what the ARIA tabs pattern asks for and what
 * a hand-rolled div-and-onClick version usually gets wrong.
 *
 * Labels arrive as one comma-separated attribute rather than as props on each
 * child, because the MDX safety gate refuses `{expressions}` in authored
 * bodies: every attribute has to be a literal string.
 */
import { Children, useId, type ReactNode } from "react";

export interface TabsProps {
  /** Comma-separated tab labels, in order, e.g. "npm, pnpm, bun". */
  labels: string;
  children: ReactNode;
}

export function Tabs({ labels, children }: TabsProps) {
  const group = useId();
  const names = labels
    .split(",")
    .map((label) => label.trim())
    .filter((label) => label !== "");
  const panels = Children.toArray(children);

  // An author who miscounts gets the shorter of the two rather than a crash or
  // a tab that opens nothing.
  const count = Math.min(names.length, panels.length);
  if (count === 0) return null;

  return (
    <div className="tabs" data-tabs={count}>
      {names.slice(0, count).map((label, index) => (
        <input
          key={`input-${label}`}
          className="tab-input"
          type="radio"
          name={group}
          id={`${group}-${index}`}
          defaultChecked={index === 0}
        />
      ))}
      <div className="tab-list">
        {names.slice(0, count).map((label, index) => (
          <label key={label} className="tab-label" htmlFor={`${group}-${index}`}>
            {label}
          </label>
        ))}
      </div>
      <div className="tab-panels">
        {panels.slice(0, count).map((panel, index) => (
          <div key={`panel-${names[index]}`} className="tab-panel">
            {panel}
          </div>
        ))}
      </div>
    </div>
  );
}

/** One panel. Exists so authored bodies read as tabs rather than as bare divs. */
export function Tab({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
