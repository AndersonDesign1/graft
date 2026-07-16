"use client";

/**
 * A bare typing strip — the terminal's little sibling. No chrome, no bar:
 * just a <pre> that replays a pre-tokenized shiki transcript. Commands
 * (`typed` lines) go out character by character; output lines land whole,
 * the way a real shell prints. Re-keyed by `runKey` so switching samples
 * restarts the take.
 *
 * Reduced motion shows the finished transcript immediately.
 */
import { useEffect, useRef, useState } from "react";
import type { TermLine } from "../../lib/highlight";

/** Total characters in a line. */
const lengthOf = (line: TermLine): number =>
  line.tokens.reduce((sum, token) => sum + token.c.length, 0);

/** Slice a line's tokens to `chars` characters, keeping each token's style. */
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

export function CliStrip({
  lines,
  runKey,
  play = true,
}: {
  lines: TermLine[];
  runKey: number;
  play?: boolean;
}) {
  const [row, setRow] = useState(0);
  const [chars, setChars] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // New sample (or replay): start the take over.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- runKey is the reset signal
  useEffect(() => {
    setRow(0);
    setChars(0);
  }, [runKey, lines]);

  useEffect(() => {
    if (!play || row >= lines.length) return;
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setRow(lines.length);
      return;
    }
    const line = lines[row]!;
    const doneTyping = !line.typed || chars >= lengthOf(line);
    timer.current = setTimeout(
      () => {
        if (doneTyping) {
          setRow((r) => r + 1);
          setChars(0);
        } else {
          setChars((c) => c + 1);
        }
      },
      doneTyping ? Math.min(line.pause, 180) : 14 + Math.random() * 22,
    );
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [play, row, chars, lines]);

  const done = row >= lines.length;
  const current = done ? null : lines[row]!;

  return (
    <pre className="cli-strip" aria-live="polite">
      {lines.slice(0, row).map((line, i) => (
        <span key={i}>
          {line.tokens.map((token, j) => (
            <span key={j} style={token.s ? parseStyle(token.s) : undefined}>
              {token.c}
            </span>
          ))}
          {"\n"}
        </span>
      ))}
      {current?.typed
        ? sliceLine(current, chars).map((token, j) => (
            <span key={j} style={token.s ? parseStyle(token.s) : undefined}>
              {token.c}
            </span>
          ))
        : null}
      {!done ? <span className="caret" aria-hidden="true" /> : null}
    </pre>
  );
}
