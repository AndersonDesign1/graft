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
import {
  AstroIcon,
  DockerIcon,
  NextjsIcon,
  NodejsIcon,
  PostgresqlIcon,
  ReactIcon,
  SqliteIcon,
  SvelteIcon,
  TanstackIcon,
  TypescriptIcon,
} from "../icons/FrameworkIcons";
import { PM_ICONS } from "./pm-icons";

function getTabIcon(rawLabel: string): ReactNode {
  const norm = rawLabel.toLowerCase().trim();

  // Frameworks & languages (check specific keywords first)
  if (norm.includes("next")) {
    return <NextjsIcon size={15} className="tab-icon" />;
  }
  if (norm.includes("typescript") || norm.includes("plain ts") || norm.startsWith("ts")) {
    return <TypescriptIcon size={15} className="tab-icon" />;
  }
  if (norm.includes("astro")) {
    return <AstroIcon size={15} className="tab-icon" />;
  }
  if (norm.includes("react")) {
    return <ReactIcon size={15} className="tab-icon" />;
  }
  if (norm.includes("svelte")) {
    return <SvelteIcon size={15} className="tab-icon" />;
  }
  if (norm.includes("tanstack")) {
    return <TanstackIcon size={15} className="tab-icon" />;
  }
  if (norm.includes("node")) {
    return <NodejsIcon size={15} className="tab-icon" />;
  }
  if (norm.includes("docker")) {
    return <DockerIcon size={15} className="tab-icon" />;
  }
  if (norm.includes("postgres")) {
    return <PostgresqlIcon size={15} className="tab-icon" />;
  }
  if (norm.includes("sqlite")) {
    return <SqliteIcon size={15} className="tab-icon" />;
  }

  // Package managers
  if (norm.includes("pnpm")) {
    return (
      <svg
        className="tab-icon"
        viewBox="0 0 24 24"
        width="15"
        height="15"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d={PM_ICONS.pnpm.d} />
      </svg>
    );
  }
  if (norm.includes("npm")) {
    return (
      <svg
        className="tab-icon"
        viewBox="0 0 24 24"
        width="15"
        height="15"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d={PM_ICONS.npm.d} />
      </svg>
    );
  }
  if (norm.includes("bun")) {
    return (
      <svg
        className="tab-icon"
        viewBox="0 0 24 24"
        width="15"
        height="15"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d={PM_ICONS.bun.d} />
      </svg>
    );
  }
  if (norm.includes("yarn")) {
    return (
      <svg
        className="tab-icon"
        viewBox="0 0 24 24"
        width="15"
        height="15"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d={PM_ICONS.yarn.d} />
      </svg>
    );
  }
  if (norm.includes("deno")) {
    return (
      <svg
        className="tab-icon"
        viewBox="0 0 24 24"
        width="15"
        height="15"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d={PM_ICONS.deno.d} />
      </svg>
    );
  }

  return null;
}

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
        {names.slice(0, count).map((label, index) => {
          const icon = getTabIcon(label);
          return (
            <label key={label} className="tab-label" htmlFor={`${group}-${index}`}>
              {icon}
              {label}
            </label>
          );
        })}
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
