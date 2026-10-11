/**
 * CodeBlock — chrome around a fenced block: what file this is, or what it is.
 *
 * Shiki already highlights the fence. What a reader cannot get from
 * highlighting is where the code goes, and a docs page full of unlabelled
 * `ts` blocks makes them guess. The title bar answers it.
 *
 * It wraps the fence rather than replacing it, so the highlighting, the dual
 * theme and the copyable text are all untouched. It adds a header, with a
 * file icon or a terminal icon for what the block is, and a border.
 *
 * Authors write the tag on its own line with blank lines around the fence.
 * Markdown only treats JSX as one block when nothing shares its line, so a
 * one-line version would render the tag as literal text.
 */
import { FileCode, SquareTerminal } from "lucide-react";
import type { ReactNode } from "react";

const BAR_ICON = { size: 15, strokeWidth: 1.5, "aria-hidden": true } as const;

/** "Terminal", "shell", "bash": a place to type, not a file. */
const SHELL = /^(terminal|shell|bash|zsh|sh|console|powershell)$/i;

export interface CodeBlockProps {
  /** Usually a path, e.g. "graft.config.ts". Also fine: "Terminal". */
  title: string;
  /** Optional right-hand note, e.g. "static tier" or "server only". */
  note?: string;
  children: ReactNode;
}

export function CodeBlock({ title, note, children }: CodeBlockProps) {
  const shell = SHELL.test(title.trim());
  return (
    <figure className="codeblock" data-kind={shell ? "shell" : "file"}>
      <figcaption className="codeblock-bar">
        {shell ? <SquareTerminal {...BAR_ICON} /> : <FileCode {...BAR_ICON} />}
        <span className="codeblock-title">{title}</span>
        {note ? <span className="codeblock-note">{note}</span> : null}
      </figcaption>
      <div className="codeblock-body">{children}</div>
    </figure>
  );
}
