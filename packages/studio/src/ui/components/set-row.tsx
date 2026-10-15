/**
 * The parts Settings is built from: a section with its heading, a labelled
 * row in a panel, and a copy button for a value someone will paste elsewhere.
 */
import { useEffect, useRef, useState } from "react";
import { IconCheck, IconCopy } from "./icons";

export function Row({
  label,
  hint,
  children,
  stack = false,
}: {
  label: string;
  hint?: string;
  children?: React.ReactNode;
  stack?: boolean;
}) {
  return (
    <div className="set-row" data-stack={stack}>
      <div>
        <p className="set-row-label">{label}</p>
        {hint ? <p className="set-row-hint">{hint}</p> : null}
      </div>
      {children ? <div className="set-row-control">{children}</div> : null}
    </div>
  );
}

export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number>(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      className="set-copy"
      data-copied={copied}
      aria-label={copied ? "Copied" : `Copy ${value}`}
      onClick={() => {
        void navigator.clipboard?.writeText(value);
        setCopied(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 1600);
      }}
    >
      {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
    </button>
  );
}

/** A heading, the line under it, and its panels. */
export function Section({
  id,
  title,
  sub,
  children,
}: {
  id: string;
  title: string;
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <section className="set-section" id={id}>
      <div>
        <h2 className="set-section-title">{title}</h2>
        <p className="set-section-sub">{sub}</p>
      </div>
      {children}
    </section>
  );
}
