/**
 * Changes — review what you edited, then commit it.
 *
 * This is the surface that makes git-authoritative content honest for someone
 * who does not use git. Every other CMS answers "what did I change?" with a
 * draft table it maintains itself; Graft answers it with the repository, which
 * means the answer is already true and already durable before this drawer
 * exists. What the drawer adds is legibility: documents rather than paths, a
 * diff you can read, and one button that records it.
 *
 * A drawer rather than a view because the question arrives *while editing* —
 * navigating away from the document you are reviewing to review it is the kind
 * of thing that makes people not review it.
 *
 * Deliberately not here:
 *   - **Push.** A local commit reaches nobody and needs no credentials.
 *     Publishing to a remote is a separate feature with separate consent (the
 *     GitHub App), and quietly bundling it into "Commit" would be a surprise
 *     of exactly the wrong kind.
 *   - **Compile.** Committing and compiling are different jobs — the top bar
 *     already owns the compile action, and a second control for it here is the
 *     duplication the Overview banner was removed for. The index state travels
 *     on each row instead, so the two axes stay visible without competing.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type {
  ChangedFileDto,
  CommitResultDto,
  ContentTree,
  FileDiffDto,
  GitChangesDto,
} from "../../types";
import { api, qs } from "../lib/api";
import {
  defaultCommitMessage,
  groupRows,
  rowLabel,
  STATUS_LABEL,
  toRows,
  type ChangeRow,
} from "../lib/changes";
import { plural } from "../lib/format";
import { STATE_HELP, STATE_LABEL, EmptyState, Status } from "./primitives";
import { IconBranches, IconCheck, IconChevron, IconExternal, IconWarning } from "./icons";
import { ListSkeleton } from "./skeletons";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import type { Route } from "../lib/route";
import type { Resource } from "../lib/use-resource";

/* ---- one file's diff ------------------------------------------------------ */

/**
 * Fetched on expand, not with the list.
 *
 * A tree of twenty edited documents is twenty diffs, and the operator reads
 * one or two of them. Loading all of them to render a list would make opening
 * the drawer the slowest thing in the Studio.
 */
function DiffBody({ path }: { path: string }) {
  const [diff, setDiff] = useState<FileDiffDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<FileDiffDto>(`/changes/diff${qs({ path })}`)
      .then((value) => !cancelled && setDiff(value))
      .catch(
        (err: unknown) => !cancelled && setError(err instanceof Error ? err.message : String(err)),
      );
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (error) {
    return (
      <p className="notice" data-tone="error">
        <IconWarning size={14} />
        <span>{error}</span>
      </p>
    );
  }
  if (!diff) return <p className="diff-note">Reading the diff…</p>;
  if (diff.binary) return <p className="diff-note">Binary file — nothing to show line by line.</p>;
  if (diff.hunks.length === 0) return <p className="diff-note">No line changes.</p>;

  return (
    <div className="diff">
      {diff.hunks.map((hunk, i) => (
        <div key={i} className="diff-hunk">
          <div className="diff-hunk-head">
            <span data-numeric="">
              @@ −{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
            </span>
            {hunk.heading ? <span className="diff-hunk-heading">{hunk.heading}</span> : null}
          </div>
          {hunk.lines.map((line, j) => (
            <div key={j} className="diff-line" data-kind={line.kind}>
              <span className="diff-gutter" data-numeric="">
                {line.oldLine ?? ""}
              </span>
              <span className="diff-gutter" data-numeric="">
                {line.newLine ?? ""}
              </span>
              <span className="diff-mark" aria-hidden="true">
                {line.kind === "add" ? "+" : line.kind === "remove" ? "−" : " "}
              </span>
              {/* Whitespace is content in markdown, so the text is rendered
                  exactly as it arrived — no trim, no collapse. */}
              <code className="diff-text">{line.text || " "}</code>
            </div>
          ))}
        </div>
      ))}
      {diff.truncated ? (
        <p className="diff-note">
          Diff truncated — open the file in git for the rest. Long diffs are usually a formatter,
          not an edit.
        </p>
      ) : null}
    </div>
  );
}

/* ---- one row -------------------------------------------------------------- */

function ChangeRowItem({
  row,
  selected,
  expanded,
  onToggleSelected,
  onToggleExpanded,
  onOpen,
}: {
  row: ChangeRow;
  selected: boolean;
  expanded: boolean;
  onToggleSelected: () => void;
  onToggleExpanded: () => void;
  onOpen?: () => void;
}) {
  return (
    <li className="change" data-expanded={expanded}>
      <div className="change-head">
        <label className="change-check">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelected}
            aria-label={`Include ${rowLabel(row)} in the commit`}
          />
        </label>

        <button
          type="button"
          className="change-main"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
        >
          <IconChevron size={12} className="change-caret" />
          <span className="change-title">{rowLabel(row)}</span>
          <span className="change-status" data-status={row.status}>
            {STATUS_LABEL[row.status]}
          </span>
          <span className="change-path">{row.from ? `${row.from} → ${row.path}` : row.path}</span>
          {/* The other axis. A committed document that was never compiled is
              still invisible to the site, and this is where that is learnable. */}
          {row.indexState && row.indexState !== "synced" ? (
            <span className="change-index" title={STATE_HELP[row.indexState]}>
              <span className="dot" data-state={row.indexState} />
              {STATE_LABEL[row.indexState]}
            </span>
          ) : null}
        </button>

        {onOpen ? (
          <button
            type="button"
            className="icon-btn change-open"
            onClick={onOpen}
            title="Open in the editor"
          >
            <IconExternal size={13} />
          </button>
        ) : null}
      </div>

      {expanded ? <DiffBody path={row.path} /> : null}
    </li>
  );
}

/* ---- the drawer ----------------------------------------------------------- */

export function ChangesDrawer({
  open,
  onOpenChange,
  changes,
  tree,
  navigate,
  onCommitted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  changes: Resource<GitChangesDto>;
  tree: ContentTree | null;
  navigate: (route: Route) => void;
  onCommitted: () => void;
}) {
  const files = useMemo<readonly ChangedFileDto[]>(() => changes.data?.files ?? [], [changes.data]);
  const rows = useMemo(() => toRows(files, tree), [files, tree]);
  const groups = useMemo(() => groupRows(rows, tree), [rows, tree]);

  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [committing, setCommitting] = useState(false);
  // Whether the operator has written their own message. Recomputing the
  // prefill over their words as they tick a box would be the worst kind of
  // helpful.
  const touched = useRef(false);

  const selected = useMemo(() => rows.filter((row) => !excluded.has(row.path)), [rows, excluded]);

  // Selection resets with the drawer, not with the list: the list refreshes
  // after a commit, and carrying stale exclusions across would silently
  // deselect files in the *next* review.
  useEffect(() => {
    if (!open) return;
    setExcluded(new Set());
    setExpanded(null);
    touched.current = false;
  }, [open]);

  useEffect(() => {
    if (!touched.current) setMessage(defaultCommitMessage(selected));
  }, [selected]);

  /** Only documents can be opened; a stray file in the content tree cannot. */
  const openRow = useCallback(
    (row: ChangeRow): (() => void) | undefined => {
      const { collection, slug } = row;
      if (!collection || !slug) return undefined;
      return () => {
        navigate({ view: "collections", collection, slug });
        onOpenChange(false);
      };
    },
    [navigate, onOpenChange],
  );

  const toggle = useCallback((path: string) => {
    setExcluded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const commit = useCallback(async () => {
    setCommitting(true);
    try {
      const result = await api<CommitResultDto>("/changes/commit", {
        method: "POST",
        body: JSON.stringify({ paths: selected.map((row) => row.path), message }),
      });
      toast.success(`Committed ${plural(result.files.length, "file")}`, {
        description: `${result.shortSha}${result.gitBranch ? ` on ${result.gitBranch}` : ""} — local only, nothing was pushed`,
      });
      touched.current = false;
      changes.refresh();
      onCommitted();
    } catch (err) {
      toast.error("Commit failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setCommitting(false);
    }
  }, [changes, message, onCommitted, selected]);

  const data = changes.data;
  const clean = Boolean(data?.tracked) && files.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="drawer">
        <header className="drawer-head">
          <div>
            <DialogTitle>Changes</DialogTitle>
            <p className="drawer-sub">
              {data?.tracked
                ? files.length === 0
                  ? "Everything on disk is committed."
                  : `${plural(files.length, "file")} changed since the last commit`
                : "Content is not under version control."}
            </p>
          </div>
          {data?.tracked && data.gitBranch ? (
            <span className="drawer-branch" title="The git branch a commit lands on">
              <IconBranches size={13} />
              {data.gitBranch}
              {data.head ? <code>{data.head}</code> : null}
            </span>
          ) : null}
        </header>

        <div className="drawer-body">
          <Status
            loading={changes.loading && !data}
            error={changes.error}
            empty={clean || !data?.tracked}
            skeleton={<ListSkeleton rows={3} />}
          >
            {data && !data.tracked ? (
              <EmptyState
                title="Not a git repository"
                icon={<IconWarning size={20} />}
                body={
                  <>
                    {data.reason} Graft keeps working — content still compiles and serves — but
                    there is no history to show or commit to. Run <code>git init</code> at the
                    project root to turn it on.
                  </>
                }
              />
            ) : (
              <EmptyState
                title="Nothing to commit"
                icon={<IconCheck size={20} />}
                body="Every content file matches the last commit. Edits you make in the Studio show up here as you save."
              />
            )}
          </Status>

          {groups.map((group) => (
            <section key={group.collection ?? "__other"} className="change-group">
              <h3 className="change-group-title">{group.collection ?? "Other files"}</h3>
              <ul className="change-list">
                {group.rows.map((row) => (
                  <ChangeRowItem
                    key={row.path}
                    row={row}
                    selected={!excluded.has(row.path)}
                    expanded={expanded === row.path}
                    onToggleSelected={() => toggle(row.path)}
                    onToggleExpanded={() =>
                      setExpanded((current) => (current === row.path ? null : row.path))
                    }
                    onOpen={openRow(row)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>

        {files.length > 0 ? (
          <footer className="drawer-foot">
            <label className="drawer-message">
              <span className="field-label">Commit message</span>
              <textarea
                rows={2}
                value={message}
                placeholder="What changed, and why"
                onChange={(event) => {
                  touched.current = true;
                  setMessage(event.target.value);
                }}
              />
            </label>
            <div className="drawer-actions">
              <Button
                variant="primary"
                disabled={committing || selected.length === 0 || !message.trim()}
                onClick={() => void commit()}
              >
                {committing ? "Committing…" : `Commit ${plural(selected.length, "file")}`}
              </Button>
              <Button onClick={() => onOpenChange(false)}>Close</Button>
              <span className="drawer-hint">Commits locally. Nothing is pushed.</span>
            </div>
          </footer>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
