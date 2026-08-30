/**
 * CodeBlock — chrome around a fenced block: what file this is, or what it is.
 *
 * Shiki already highlights the fence. What a reader cannot get from
 * highlighting is where the code goes, and a docs page full of unlabelled
 * `ts` blocks makes them guess. The title bar answers it.
 *
 * It wraps the fence rather than replacing it, so the highlighting, the dual
 * theme and the copyable text are all untouched — this adds a header and a
 * border and gets out of the way.
 *
 * Authors write the tag on its own line with blank lines around the fence.
 * Markdown only treats JSX as one block when nothing shares its line, so a
 * one-line version would render the tag as literal text.
 */
import type { ReactNode } from "react";

export interface CodeBlockProps {
  /** Usually a path, e.g. "graft.config.ts". Also fine: "Terminal". */
  title: string;
  /** Optional right-hand note, e.g. "static tier" or "server only". */
  note?: string;
  children: ReactNode;
}

export function CodeBlock({ title, note, children }: CodeBlockProps) {
  return (
    <figure className="codeblock">
      <figcaption className="codeblock-bar">
        <span className="codeblock-title">{title}</span>
        {note ? <span className="codeblock-note">{note}</span> : null}
      </figcaption>
      <div className="codeblock-body">{children}</div>
    </figure>
  );
}
