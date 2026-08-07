/**
 * Domain primitives — the Studio's own vocabulary.
 *
 * Generic controls (button, menu, dialog, tabs, fields) live in ./ui and are
 * Base UI wrappers following shadcn's structure. What is here is specific to
 * Graft: document state, collection identity, compilation deltas.
 *
 * State travels as a `data-state`/`data-tone` attribute rather than a
 * conditional class string — one CSS rule per state, so adding a state is a
 * token block plus a rule, with no component edit.
 */
import type { ReactNode } from "react";
import type { DocumentState } from "../../types";
import { identityIndex } from "../lib/format";
import { cn } from "../lib/cn";
import { IconCheck, IconWarning } from "./icons";

/* ---- state vocabulary ---------------------------------------------------- */

export const STATE_LABEL: Record<DocumentState, string> = {
  synced: "In sync",
  drifted: "Drifted",
  unindexed: "Not indexed",
  orphaned: "Orphaned",
};

export const STATE_HELP: Record<DocumentState, string> = {
  synced: "On disk and in the index — hashes match.",
  drifted: "Edited on disk since the last compile.",
  unindexed: "On disk but never compiled into the index.",
  orphaned: "In the index but the file is gone.",
};

export function StatusDot({ state, title }: { state: DocumentState; title?: string }) {
  return <span className="dot" data-state={state} title={title ?? STATE_HELP[state]} />;
}

export function StatePill({ state }: { state: DocumentState }) {
  return (
    <span className="pill" data-state={state} title={STATE_HELP[state]}>
      <span className="dot" data-state={state} />
      {STATE_LABEL[state]}
    </span>
  );
}

export function Pill({
  tone,
  children,
  title,
  className,
}: {
  tone: "pending" | "ready" | "denied" | "db" | "file" | "neutral";
  children: ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <span data-slot="pill" className={cn("pill", className)} data-tone={tone} title={title}>
      {children}
    </span>
  );
}

/** Schema field type — an identity axis, so colour by type, not by severity. */
export function TypeBadge({ type }: { type: string }) {
  return (
    <code className="type" data-type={type}>
      {type}
    </code>
  );
}

/* ---- collection identity ------------------------------------------------- */

export function IdentityMark({
  name,
  count,
  size = "md",
}: {
  name: string;
  count?: number;
  size?: "sm" | "md";
}) {
  return (
    <span
      className="identity"
      data-size={size}
      style={{ "--identity": `var(--identity-${identityIndex(name)})` } as React.CSSProperties}
      aria-hidden="true"
    >
      {count === undefined ? name.slice(0, 1).toUpperCase() : count}
    </span>
  );
}

/* ---- status / empty ------------------------------------------------------ */

export function Status({
  loading,
  error,
  empty,
  children,
  skeleton,
}: {
  loading?: boolean;
  error?: string | null;
  empty?: boolean;
  children?: ReactNode;
  /**
   * A placeholder shaped like the content that is coming. Callers pass the
   * one matching their layout; the generic bars are only a fallback, because
   * a skeleton that doesn't match still makes the page jump on arrival.
   */
  skeleton?: ReactNode;
}) {
  if (error) {
    return (
      <p className="notice" data-tone="error">
        <IconWarning size={14} />
        <span>{error}</span>
      </p>
    );
  }
  if (loading) return <>{skeleton ?? <Skeleton rows={4} />}</>;
  if (empty) return <>{children}</>;
  return null;
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="sk" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="sk-bar" style={{ width: `${100 - i * 12}%` }} />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
  icon,
}: {
  title: string;
  body: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="empty">
      {icon ? <span className="empty-icon">{icon}</span> : null}
      <h3>{title}</h3>
      <p>{body}</p>
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  );
}

/* ---- overview widgets ---------------------------------------------------- */

export function StatTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number | string;
  hint?: string;
  tone?: "synced" | "drifted" | "unindexed" | "orphaned" | "db";
}) {
  return (
    <div className="tile" {...(tone ? { "data-tone": tone } : {})}>
      <span className="tile-label">{label}</span>
      <span className="tile-value" data-numeric="">
        {value}
      </span>
      {hint ? <span className="tile-hint">{hint}</span> : null}
    </div>
  );
}

export function DeltaChart({
  points,
}: {
  points: Array<{ added: number; changed: number; removed: number; label: string }>;
}) {
  if (points.length === 0) return null;
  const max = Math.max(1, ...points.map((p) => p.added + p.changed + p.removed));
  const w = 4;
  const gap = 2;
  const height = 40;

  return (
    <svg
      className="chart"
      viewBox={`0 0 ${points.length * (w + gap)} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Compilation deltas, newest last"
    >
      {points.map((p, i) => {
        const total = p.added + p.changed + p.removed;
        const scale = (n: number) => (n / max) * height;
        const x = i * (w + gap);
        let y = height - scale(total);
        const segs: Array<[string, number]> = [
          ["add", scale(p.added)],
          ["change", scale(p.changed)],
          ["remove", scale(p.removed)],
        ];
        return (
          <g key={i}>
            <title>{`${p.label} · +${p.added} ~${p.changed} −${p.removed}`}</title>
            {total === 0 ? (
              <rect x={x} y={height - 1} width={w} height={1} data-seg="empty" />
            ) : (
              segs.map(([seg, h]) => {
                if (h <= 0) return null;
                const rect = <rect key={seg} x={x} y={y} width={w} height={h} data-seg={seg} />;
                y += h;
                return rect;
              })
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function Delta({
  added,
  changed,
  removed,
}: {
  added: number;
  changed: number;
  removed: number;
}) {
  return (
    <span className="delta" data-numeric="">
      <span data-seg="add">+{added}</span>
      <span data-seg="change">~{changed}</span>
      <span data-seg="remove">−{removed}</span>
    </span>
  );
}

export function InlineOk({ children }: { children: ReactNode }) {
  return (
    <p className="notice" data-tone="ok">
      <IconCheck size={14} />
      <span>{children}</span>
    </p>
  );
}
