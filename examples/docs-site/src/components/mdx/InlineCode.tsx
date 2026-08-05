/**
 * Inline `code` for docs prose. CLI-shaped snippets get token colors from
 * the same --code-* palette the terminals use; everything else stays plain.
 */
import type { ComponentPropsWithoutRef, ReactNode } from "react";

type Props = ComponentPropsWithoutRef<"code">;

/** Split a CLI-ish string into colored spans. */
function tokenize(text: string): ReactNode[] {
  // Paths keep a trailing `/`; bare `/` between commands stays a separator.
  const re =
    /(\s+)|(--[\w-]+)|(-[\w])|(<[^>\s]+>)|(\[[^\]]+\])|([\w@.-]+\/)|(\/)|([^\s/<\[\]]+)/g;
  const out: ReactNode[] = [];
  let i = 0;
  let atCommandHead = true;

  for (const m of text.matchAll(re)) {
    const [, ws, longFlag, shortFlag, angle, bracket, pathDir, slash, word] = m;
    const key = `${i++}:${m[0]}`;

    if (ws) {
      out.push(<span key={key}>{ws}</span>);
      continue;
    }
    if (longFlag || shortFlag) {
      out.push(
        <span key={key} className="cli-flag">
          {longFlag || shortFlag}
        </span>,
      );
      atCommandHead = false;
      continue;
    }
    if (angle || bracket) {
      out.push(
        <span key={key} className="cli-arg">
          {angle || bracket}
        </span>,
      );
      atCommandHead = false;
      continue;
    }
    if (pathDir) {
      out.push(
        <span key={key} className="cli-path">
          {pathDir}
        </span>,
      );
      atCommandHead = false;
      continue;
    }
    if (slash) {
      out.push(
        <span key={key} className="cli-sep">
          {slash}
        </span>,
      );
      atCommandHead = true;
      continue;
    }
    if (word) {
      const isPath = /[.]/.test(word);
      const isBin = atCommandHead && (word === "graft" || word === "pnpm");
      const cls = isBin ? "cli-bin" : isPath ? "cli-path" : "cli-cmd";
      out.push(
        <span key={key} className={cls}>
          {word}
        </span>,
      );
      atCommandHead = false;
    }
  }

  return out;
}

function shouldColorize(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 120) return false;
  return (
    /^(graft|pnpm)\b/.test(t) ||
    /^--?[\w-]/.test(t) ||
    /^[\w@./-]+\.(ts|tsx|js|jsx|mdx|txt|json)\b/.test(t) ||
    /^[\w-]+\/$/.test(t)
  );
}

export function InlineCode({ children, className, ...props }: Props) {
  // Shiki / fenced blocks pass a language class — leave them alone.
  if (className?.includes("language-")) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  }

  const text =
    typeof children === "string"
      ? children
      : Array.isArray(children) && children.every((c) => typeof c === "string")
        ? children.join("")
        : null;

  if (text && shouldColorize(text)) {
    return (
      <code className={["cli-code", className].filter(Boolean).join(" ")} {...props}>
        {tokenize(text)}
      </code>
    );
  }

  return (
    <code className={className} {...props}>
      {children}
    </code>
  );
}
