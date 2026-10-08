/**
 * Pre — every fenced block gets a copy button in its top-right corner.
 *
 * Bodies render to static HTML, so the button cannot carry a React handler.
 * It is plain markup with a data attribute, and one delegated listener in
 * DocsRoot.astro does the copying for every block on the page. The listener
 * copies the <code> element's text, which is exactly what the author wrote:
 * the button holds icons and an aria-label, and the visually hidden status
 * (a live region, so the result is announced) sits outside the <code>.
 *
 * The button sits inside the <pre> so the selectors that frame a fence in a
 * tab panel or a CodeBlock (`.tab-panel > pre.shiki`, `.codeblock-body
 * pre.shiki`) keep matching. The <pre> stops scrolling and the <code> inside
 * it scrolls instead, stopping short of the button, so the button stays put
 * and a long line never runs under it.
 */
import { Check, Copy } from "lucide-react";
import type { ComponentPropsWithoutRef } from "react";

const ICON = { size: 14, strokeWidth: 1.75, "aria-hidden": true } as const;

export function Pre({ children, ...props }: ComponentPropsWithoutRef<"pre">) {
  return (
    <pre {...props}>
      {children}
      <button type="button" className="copy-code" data-copy-code aria-label="Copy code">
        <Copy {...ICON} className="copy-code-idle" />
        <Check {...ICON} className="copy-code-done" />
      </button>
      <span className="sr-only" role="status" data-copy-status />
    </pre>
  );
}
