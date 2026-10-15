/**
 * AgentPrompt — the exact prompt that makes a coding agent do the page.
 *
 * Every guide that ends in a working result opens with one, so a reader with
 * an agent can hand the page over in one paste. The body is authored MDX and
 * renders to static HTML. The copy button is plain markup: the delegated
 * listener in DocsRoot.astro copies the text of the nearest [data-copy-text],
 * the same way it copies a fence.
 */
import { Bot, Check, Copy } from "lucide-react";
import type { ReactNode } from "react";

const ICON = { size: 15, strokeWidth: 1.5, "aria-hidden": true } as const;

export function AgentPrompt({ children }: { children: ReactNode }) {
  return (
    <aside className="agent-prompt" aria-label="Prompt for a coding agent" data-copy-root>
      <div className="agent-prompt-bar">
        <Bot {...ICON} />
        <span className="agent-prompt-title">Let your agent do it</span>
        <button
          type="button"
          className="copy-code"
          data-copy-code
          aria-label="Copy prompt"
          title="Copy prompt"
        >
          <Copy {...ICON} size={14} className="copy-code-idle" />
          <Check {...ICON} size={14} className="copy-code-done" />
        </button>
      </div>
      <div className="agent-prompt-body" data-copy-text>
        {children}
      </div>
      <span className="sr-only" role="status" data-copy-status />
    </aside>
  );
}
