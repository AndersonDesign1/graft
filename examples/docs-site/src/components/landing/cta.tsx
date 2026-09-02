"use client";

/**
 * Closing CTA — human install + agent MCP path.
 * Real brand marks from /public/agents (Claude, Cursor, Codex, Copilot, Gemini).
 */
import { useCallback, useState } from "react";

const INIT_CMD = "pnpm dlx @usegraft/cli init";
const MCP_CMD = "graft mcp";

const AGENTS = [
  { name: "Claude", src: "/agents/claude.svg" },
  { name: "Cursor", src: "/agents/cursor.svg" },
  { name: "Codex", src: "/agents/codex.svg" },
  { name: "Copilot", src: "/agents/copilot.svg" },
  { name: "Gemini", src: "/agents/gemini.svg" },
] as const;

function useCopy() {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard denied */
    }
  }, []);
  return { copied, copy };
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect
        x="5.5"
        y="5.5"
        width="8"
        height="8"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.25"
      />
      <path
        d="M10.5 5.5V4A1.5 1.5 0 0 0 9 2.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5"
        stroke="currentColor"
        strokeWidth="1.25"
      />
    </svg>
  );
}

/**
 * The command is one prop, not a hand-written label beside duplicated children.
 * The label read "Copy init command" over visible text reading
 * "$ pnpm dlx @usegraft/cli init", which fails WCAG 2.5.3 Label in Name: a
 * speech-input user says what they see, and nothing they could see appeared in
 * the name they had to say. Deriving the label from the command means the two
 * cannot drift. The prompt marker is hidden — it is decoration, and it is not
 * part of what the button copies.
 */
function CopyRow({ command, mono = false }: { command: string; mono?: boolean }) {
  const { copied, copy } = useCopy();
  return (
    <button
      type="button"
      className="cta-copy"
      data-mono={mono || undefined}
      aria-label={copied ? "Copied" : `Copy ${command}`}
      onClick={() => copy(command)}
    >
      <span className="cta-copy-text">
        <span aria-hidden="true">$ </span>
        {command}
      </span>
      <span className="cta-copy-affordance" aria-hidden="true">
        {copied ? "✓" : <CopyIcon />}
      </span>
    </button>
  );
}

function AgentMarks() {
  return (
    <ul className="cta-agents" aria-label="Claude, Cursor, Codex, Copilot, Gemini">
      {AGENTS.map((a) => (
        <li key={a.name} className="cta-agent-mark" title={a.name}>
          <img src={a.src} alt="" width={48} height={48} decoding="async" />
          <span className="visually-hidden">{a.name}</span>
        </li>
      ))}
    </ul>
  );
}

export function ClosingCta() {
  return (
    <div className="cta-wrap">
      <div className="cta-bento">
        <div className="cta-cell cta-agent">
          <AgentMarks />
          <p className="cta-cell-label">For your agent</p>
          <h3>Connect MCP or the CLI.</h3>
          <p className="cta-cell-body">
            Tool descriptions and error <code>fix</code> fields teach the loop. Claude, Cursor,
            Codex, Copilot, Gemini — anything that speaks MCP.
          </p>
          <CopyRow command={MCP_CMD} mono />
        </div>

        <div className="cta-cell cta-init">
          <p className="cta-cell-label">For you</p>
          <h3>Scaffold the repo.</h3>
          <p className="cta-cell-body">
            One command. Config and the first document: files you own on your machine.
          </p>
          <CopyRow command={INIT_CMD} mono />
        </div>
      </div>

      <div className="cta-actions">
        <a className="button-ghost" href="/why">
          Why Graft
        </a>
        <a className="button-primary" href="/docs/what-is-graft">
          What is Graft
        </a>
      </div>
    </div>
  );
}
