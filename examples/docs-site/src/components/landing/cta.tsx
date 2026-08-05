"use client";

/**
 * Closing CTA — human install + agent guide.
 * Real brand marks from /public/agents (Claude, Cursor, Codex, Copilot, Gemini).
 */
import { useCallback, useState, type ReactNode } from "react";

const INIT_CMD = "pnpm dlx graft init";

const AGENTS = [
  { name: "Claude", src: "/agents/claude.svg" },
  { name: "Cursor", src: "/agents/cursor.svg" },
  { name: "Codex", src: "/agents/codex.svg" },
  { name: "Copilot", src: "/agents/copilot.svg" },
  { name: "Gemini", src: "/agents/gemini.svg" },
] as const;

function agentPrompt() {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const guide = origin ? `${origin}/llms.txt` : "/llms.txt";
  return (
    `Read ${guide}. Graft keeps content as MDX in git; graft.config.ts is the schema; ` +
    "Postgres is a derived index. Scaffold with `pnpm dlx graft init`, then operate via MCP or the CLI."
  );
}

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
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.25" />
      <path
        d="M10.5 5.5V4A1.5 1.5 0 0 0 9 2.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5"
        stroke="currentColor"
        strokeWidth="1.25"
      />
    </svg>
  );
}

function CopyRow({
  getText,
  children,
  mono = false,
  ariaLabel,
}: {
  getText: () => string;
  children: ReactNode;
  mono?: boolean;
  ariaLabel: string;
}) {
  const { copied, copy } = useCopy();
  return (
    <button
      type="button"
      className="cta-copy"
      data-mono={mono || undefined}
      aria-label={copied ? "Copied" : ariaLabel}
      onClick={() => copy(getText())}
    >
      <span className="cta-copy-text">{children}</span>
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
          <h3>Paste the project guide.</h3>
          <p className="cta-cell-body">
            <code>llms.txt</code> + MCP — Claude, Cursor, Codex, Copilot, Gemini, or anything that
            can fetch a URL.
          </p>
          <CopyRow getText={agentPrompt} ariaLabel="Copy agent setup prompt">
            Copy setup prompt → /llms.txt
          </CopyRow>
        </div>

        <div className="cta-cell cta-init">
          <p className="cta-cell-label">For you</p>
          <h3>Scaffold the repo.</h3>
          <p className="cta-cell-body">
            One command. Config, first document, agent guide — files you own.
          </p>
          <CopyRow getText={() => INIT_CMD} mono ariaLabel="Copy init command">
            $ {INIT_CMD}
          </CopyRow>
        </div>
      </div>

      <div className="cta-actions">
        <a className="button-ghost" href="/docs">
          Read the docs
        </a>
        <a className="button-primary" href="/docs/getting-started">
          Start building
        </a>
      </div>
    </div>
  );
}
