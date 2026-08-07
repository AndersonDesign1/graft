/**
 * Shared primitives.
 *
 * State is carried as a `data-state` attribute rather than a conditional
 * class string. One CSS rule per state, so adding a fifth document state is
 * a token block plus a rule — no component edit, no className ternaries.
 */
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { DocumentState } from "../../types";
import { identityIndex } from "../lib/format";
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

/** Generic pill for non-document state (pending, ready, db, …). */
export function Pill({
  tone,
  children,
  title,
}: {
  tone: "pending" | "ready" | "denied" | "db" | "neutral";
  children: ReactNode;
  title?: string;
}) {
  return (
    <span className="pill" data-tone={tone} title={title}>
      {children}
    </span>
  );
}

/* ---- collection identity ------------------------------------------------- */

/**
 * Collections get a stable mark colour, like Sanity's document-type icons.
 * The component only ever reads `var(--identity)`; the cycle it points into
 * is defined in roles.css.
 */
export function IdentityMark({ name, count }: { name: string; count?: number }) {
  return (
    <span
      className="identity"
      style={{ "--identity": `var(--identity-${identityIndex(name)})` } as React.CSSProperties}
      aria-hidden="true"
    >
      {count === undefined ? name.slice(0, 1).toUpperCase() : count}
    </span>
  );
}

/* ---- buttons ------------------------------------------------------------- */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "danger" | "ghost";
  size?: "sm" | "md";
};

export function Button({ variant = "default", size = "md", ...rest }: ButtonProps) {
  return <button type="button" className="btn" data-variant={variant} data-size={size} {...rest} />;
}

/* ---- status / empty ------------------------------------------------------ */

/**
 * Every async pane renders this. The empty state is a teaching surface: the
 * old UI said "No documents in this collection" when the real answer was
 * "nothing has been compiled yet", which sent people looking in the wrong
 * place entirely.
 */
export function Status({
  loading,
  error,
  empty,
  children,
}: {
  loading?: boolean;
  error?: string | null;
  empty?: boolean;
  children?: ReactNode;
}) {
  if (error) {
    return (
      <p className="notice" data-tone="error">
        <IconWarning size={14} />
        <span>{error}</span>
      </p>
    );
  }
  if (loading) return <Skeleton rows={4} />;
  if (empty) return <>{children}</>;
  return null;
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        // Stagger is decorative and short — a long cascade reads as slowness.
        <span key={i} style={{ "--d": `${i * 60}ms` } as React.CSSProperties} />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
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

/**
 * Compilation trail as stacked bars — the one genuinely chart-shaped dataset
 * the product has. Pure SVG, sized by viewBox so it scales with the card.
 */
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
        const a = scale(p.added);
        const c = scale(p.changed);
        const r = scale(p.removed);
        const x = i * (w + gap);
        let y = height - a - c - r;
        const segs: Array<[string, number]> = [
          ["add", a],
          ["change", c],
          ["remove", r],
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

export function Delta({ added, changed, removed }: { added: number; changed: number; removed: number }) {
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
