"use client";

/**
 * A terminal that types a real CLI transcript.
 *
 * Coloring comes from shiki — the same highlighter, themes and dual-theme CSS
 * variables the docs code blocks use — tokenized at build time and passed in as
 * props (lib/highlight.ts). The terminal and the docs are colored by one source
 * of truth; there is no second palette to drift.
 *
 * Types when it is genuinely on screen (threshold, not rootMargin — a margin
 * fires on short viewports while only a sliver is visible and the type-out is
 * wasted below the fold). Replayable; reduced-motion shows the finished
 * transcript immediately.
 *
 * The wow loop is split across two surfaces in v5: the hero types `init`, the
 * stage types `compile`. Pass `label` so the chrome names the half you are on.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TermLine } from "../../lib/highlight";
import { useInView } from "./reveal";

/** Total characters in a line. */
const lengthOf = (line: TermLine): number =>
  line.tokens.reduce((sum, token) => sum + token.c.length, 0);

/** Slice a line's tokens to `chars` characters, preserving each token's style. */
function sliceLine(line: TermLine, chars: number): TermLine["tokens"] {
  if (chars >= lengthOf(line)) return line.tokens;
  const out: TermLine["tokens"] = [];
  let left = chars;
  for (const token of line.tokens) {
    if (left <= 0) break;
    out.push(left >= token.c.length ? token : { ...token, c: token.c.slice(0, left) });
    left -= token.c.length;
  }
  return out;
}

export function Terminal({
  lines,
  label = "Terminal",
  /** Skip the in-view gate — used when a parent (the stage) already decides visibility. */
  play = false,
}: {
  lines: TermLine[];
  label?: string;
  play?: boolean;
}) {
  // Wait until half the terminal is actually on screen — unless a parent arms us.
  const { ref, inView } = useInView<HTMLDivElement>("0px", 0.5);
  const armed = play || inView;
  const [row, setRow] = useState(0); // lines fully shown
  const [chars, setChars] = useState(0); // chars of the current typed line
  const [run, setRun] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reduced = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  const replay = useCallback(() => {
    setRow(0);
    setChars(0);
    setRun((r) => r + 1);
  }, []);

  useEffect(() => {
    if (!armed) return;
    if (reduced) {
      setRow(lines.length);
      return;
    }
    if (row >= lines.length) return;

    const line = lines[row]!;
    const full = lengthOf(line);
    const doneTyping = !line.typed || chars >= full;

    timer.current = setTimeout(
      () => {
        if (doneTyping) {
          setRow((r) => r + 1);
          setChars(0);
        } else {
          setChars((c) => c + 1);
        }
      },
      doneTyping ? line.pause : 34 + Math.random() * 40,
    );
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [armed, row, chars, reduced, run, lines]);

  const done = row >= lines.length;
  const current = done ? null : lines[row]!;

  return (
    <div ref={ref} className="terminal">
      <div className="terminal-bar">
        <span className="terminal-traffic" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="terminal-title">{label}</span>
        <button type="button" className="terminal-replay" onClick={replay}>
          replay
        </button>
      </div>
      <pre className="terminal-body" aria-label={`Terminal demo: ${label}`}>
        {lines.slice(0, row).map((line, i) => (
          <span key={i}>
            {line.tokens.map((token, j) => (
              <span key={j} style={{ ...(token.s ? parseStyle(token.s) : {}) }}>
                {token.c}
              </span>
            ))}
            {"\n"}
          </span>
        ))}
        {current?.typed
          ? sliceLine(current, chars).map((token, j) => (
              <span key={j} style={{ ...(token.s ? parseStyle(token.s) : {}) }}>
                {token.c}
              </span>
            ))
          : null}
        {!done ? <span className="caret" aria-hidden="true" /> : null}
      </pre>
    </div>
  );
}

/** "--shiki-light:#abc;--shiki-dark:#def" → a React style object. */
function parseStyle(style: string): React.CSSProperties {
  const out: Record<string, string> = {};
  for (const decl of style.split(";")) {
    const i = decl.indexOf(":");
    if (i === -1) continue;
    out[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
  }
  return out as React.CSSProperties;
}
