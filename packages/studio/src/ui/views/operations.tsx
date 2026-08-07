/** Approvals, Branches, History — the operational list views. */
import { useState } from "react";
import type {
  ApprovalList,
  BranchList,
  CompilationDto,
  CompilationList,
  PendingApprovalDto,
} from "../../types";
import { IconCheck, IconCopy, IconHistory } from "../components/icons";
import { Delta, EmptyState, Pill, Status } from "../components/primitives";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "../components/ui/dialog";
import { api, qs } from "../lib/api";
import { absoluteTime, relativeTime, shortSha, plural } from "../lib/format";
import { useResource } from "../lib/use-resource";

export function ApprovalsView({ onDecided }: { onDecided?: () => void }) {
  const { data, error, loading, refresh } = useResource<ApprovalList>("/approvals");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function decide(row: PendingApprovalDto, decision: "approved" | "denied") {
    setBusy(row.id);
    setActionError(null);
    setMsg(null);
    try {
      await api(`/approvals/${encodeURIComponent(row.id)}/decide`, {
        method: "POST",
        body: JSON.stringify({ decision }),
      });
      setMsg(`${row.functionName} ${decision}`);
      refresh();
      onDecided?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const rows = data?.approvals ?? [];

  return (
    <div className="view">
      <header className="view-head">
        <div>
          <h1 className="view-title">Approvals</h1>
          <p className="view-sub">
            Destructive calls from agents wait here. Approve so the agent can retry; deny to refuse.
          </p>
        </div>
        {rows.length > 0 ? <Pill tone="pending">{plural(rows.length, "waiting")}</Pill> : null}
      </header>

      <Status loading={loading && !data} error={error ?? actionError} empty={rows.length === 0}>
        <EmptyState
          title="Queue is clear"
          icon={<IconCheck size={20} />}
          body="No agent is waiting on a decision. Destructive typed functions land here when they need a human."
        />
      </Status>
      {msg ? (
        <p className="notice" data-tone="ok">
          {msg}
        </p>
      ) : null}

      <ul className="stack">
        {rows.map((row) => (
          <li key={row.id}>
            <article className="card">
              <div className="card-head">
                <div>
                  <h2 className="card-title">{row.functionName}</h2>
                  <p className="card-sub">
                    {row.requestedByKind}
                    {row.requestedById ? `:${row.requestedById}` : ""} · branch {row.branchId} ·{" "}
                    <time dateTime={row.createdAt} title={absoluteTime(row.createdAt)}>
                      {relativeTime(row.createdAt)}
                    </time>
                  </p>
                </div>
                <Pill tone="pending">Pending</Pill>
              </div>
              <details className="disclosure">
                <summary>Request payload</summary>
                <pre className="well">{JSON.stringify(row.input, null, 2)}</pre>
              </details>
              <div className="card-actions">
                <Button
                  variant="primary"
                  disabled={busy === row.id}
                  onClick={() => void decide(row, "approved")}
                >
                  Approve
                </Button>
                <Button
                  variant="destructive"
                  disabled={busy === row.id}
                  onClick={() => void decide(row, "denied")}
                >
                  Deny
                </Button>
              </div>
            </article>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BranchesView({
  branch,
  onSelectBranch,
}: {
  branch: string;
  onSelectBranch: (name: string) => void;
}) {
  const { data, error, loading } = useResource<BranchList>("/branches");
  const rows = data?.branches ?? [];

  return (
    <div className="view">
      <header className="view-head">
        <div>
          <h1 className="view-title">Branches</h1>
          <p className="view-sub">
            Every branch is a real Postgres scope. Selecting one re-scopes the whole Studio.
          </p>
        </div>
      </header>

      <Status loading={loading && !data} error={error} empty={rows.length === 0}>
        <EmptyState
          title="No branches registered"
          body={
            <>
              Only the default scope exists. Create one with{" "}
              <code>graft branch create &lt;name&gt;</code>.
            </>
          }
        />
      </Status>

      <ul className="stack">
        {rows.map((row) => (
          <li key={row.name}>
            <button
              type="button"
              className="row row-lg"
              data-active={row.name === branch}
              onClick={() => onSelectBranch(row.name)}
            >
              <span className="row-main">
                <span className="row-title">
                  {row.name}
                  {row.name === branch ? <span className="tag">current</span> : null}
                </span>
                <span className="row-sub">
                  {row.backend}
                  {row.parent ? ` ← ${row.parent}` : " · root"}
                  {row.endpointHost ? ` · ${row.endpointHost}` : ""}
                </span>
              </span>
              <Pill tone="ready">{row.status}</Pill>
              <time
                className="row-meta"
                dateTime={row.createdAt}
                title={absoluteTime(row.createdAt)}
              >
                {relativeTime(row.createdAt)}
              </time>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="copy"
      aria-label={`Copy ${label}`}
      onClick={() => {
        void navigator.clipboard?.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      }}
    >
      {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/**
 * Detail for one compilation. The projection stores counts rather than the
 * changed slugs, so this shows everything the trail actually records — and
 * says so, instead of implying a per-document diff exists.
 */
function CompilationDetail({ row, onClose }: { row: CompilationDto; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="dialog-detail">
        <DialogTitle>Compilation</DialogTitle>
        <dl className="facts">
          <div>
            <dt>When</dt>
            <dd>
              <time dateTime={row.createdAt}>{absoluteTime(row.createdAt)}</time>{" "}
              <span className="muted">({relativeTime(row.createdAt)})</span>
            </dd>
          </div>
          <div>
            <dt>Branch</dt>
            <dd>
              <code>{row.branchId}</code>
            </dd>
          </div>
          <div>
            <dt>Commit</dt>
            <dd>
              {row.gitSha ? (
                <span className="fact-copy">
                  <code>{row.gitSha}</code>
                  <CopyButton value={row.gitSha} label="commit sha" />
                </span>
              ) : (
                <span className="muted">Not a git repository at compile time</span>
              )}
            </dd>
          </div>
          <div>
            <dt>Change</dt>
            <dd>
              <Delta added={row.added} changed={row.changed} removed={row.removed} />
            </dd>
          </div>
          <div>
            <dt>Indexed</dt>
            <dd data-numeric="">{plural(row.docCount, "document")} after this run</dd>
          </div>
          <div>
            <dt>Run id</dt>
            <dd>
              <span className="fact-copy">
                <code>{row.id}</code>
                <CopyButton value={row.id} label="run id" />
              </span>
            </dd>
          </div>
        </dl>
        <p className="dialog-note">
          The trail records counts, not which documents changed — the projection is a hash diff, so
          per-document history lives in git.
        </p>
        <div className="card-actions">
          <Button onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function HistoryView({ branch }: { branch: string }) {
  const { data, error, loading } = useResource<CompilationList>(
    `/compilations${qs({ branch, limit: 100 })}`,
  );
  const [selected, setSelected] = useState<CompilationDto | null>(null);
  const rows = data?.compilations ?? [];

  return (
    <div className="view">
      <header className="view-head">
        <div>
          <h1 className="view-title">History</h1>
          <p className="view-sub">
            Every projection of <code>{branch}</code> into the index — newest first. Select a run
            for detail.
          </p>
        </div>
      </header>

      <Status loading={loading && !data} error={error} empty={rows.length === 0}>
        <EmptyState
          title="Nothing compiled yet"
          icon={<IconHistory size={20} />}
          body={
            <>
              This branch has never been projected. Compile from Overview, or run{" "}
              <code>graft compile</code>.
            </>
          }
        />
      </Status>

      {rows.length > 0 ? (
        <table className="table table-rows">
          <thead>
            <tr>
              <th>Commit</th>
              <th>Change</th>
              <th className="num">Documents</th>
              <th className="num">When</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                tabIndex={0}
                role="button"
                aria-label={`Compilation ${shortSha(row.gitSha) || row.id}`}
                onClick={() => setSelected(row)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelected(row);
                  }
                }}
              >
                <td>
                  {row.gitSha ? (
                    <code>{shortSha(row.gitSha)}</code>
                  ) : (
                    <span className="muted">no git sha</span>
                  )}
                </td>
                <td>
                  <Delta added={row.added} changed={row.changed} removed={row.removed} />
                </td>
                <td className="num" data-numeric="">
                  {row.docCount}
                </td>
                <td className="num">
                  <time dateTime={row.createdAt} title={absoluteTime(row.createdAt)}>
                    {relativeTime(row.createdAt)}
                  </time>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {selected ? (
        <CompilationDetail row={selected} onClose={() => setSelected(null)} />
      ) : null}
    </div>
  );
}
