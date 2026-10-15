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
import { cn } from "../lib/cn";
import { useDatabase } from "../lib/studio";
import { IconCheck, IconDatabase, IconWarning } from "./icons";

/* ---- state vocabulary ---------------------------------------------------- */

export const STATE_LABEL: Record<DocumentState, string> = {
  synced: "In sync",
  drifted: "Out of date",
  unindexed: "Not indexed",
  orphaned: "File missing",
};

export const STATE_HELP: Record<DocumentState, string> = {
  synced: "On disk and in the index, and the two match.",
  drifted: "Edited on disk since the last compile.",
  unindexed: "On disk, with no row in the index.",
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

/**
 * What a view shows when its data lives in Postgres and this Studio has none:
 * what it would hold, that editing still works, and how to add a database.
 */
export function NeedsDatabase({ title, does }: { title: string; does: string }) {
  return (
    <EmptyState
      icon={<IconDatabase size={16} aria-hidden="true" />}
      title={title}
      body={
        <>
          {does} This Studio runs without one, so you can edit and commit content, but not this. To
          add one, set <code>DATABASE_URL</code> in the project's <code>.env</code>, run{" "}
          <code>graft db migrate</code> and <code>graft compile</code>, then restart Studio.
        </>
      }
    />
  );
}

/**
 * Children that read Postgres mount only when this Studio has a database, so
 * a Studio without one never asks for what would fail. Given `view`, the
 * panel stands in for a whole view and keeps its title.
 */
export function RequiresDatabase({
  view,
  title,
  does,
  children,
}: {
  view?: string;
  title: string;
  does: string;
  children: ReactNode;
}) {
  const database = useDatabase();
  if (database === undefined) return <Skeleton rows={3} />;
  if (database) return <>{children}</>;
  if (!view) return <NeedsDatabase title={title} does={does} />;
  return (
    <div className="view">
      <header className="view-head">
        <div>
          <h1 className="view-title">{view}</h1>
        </div>
      </header>
      <NeedsDatabase title={title} does={does} />
    </div>
  );
}

/* ---- overview widgets ---------------------------------------------------- */

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
