/** Approvals, Branches, History — the operational list views. */
import { useState } from "react";
import type {
  ApprovalList,
  BranchList,
  CompilationList,
  PendingApprovalDto,
} from "../../types";
import { Button, Delta, EmptyState, Pill, Status } from "../components/primitives";
import { api, qs } from "../lib/api";
import { absoluteTime, relativeTime, shortSha, plural } from "../lib/format";
import { useResource } from "../lib/use-resource";

export function ApprovalsView() {
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
            {/* Not styled as an alert: a pending approval is normal operation,
                not an error. */}
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
                  variant="danger"
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
              <time className="row-meta" dateTime={row.createdAt} title={absoluteTime(row.createdAt)}>
                {relativeTime(row.createdAt)}
              </time>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function HistoryView({ branch }: { branch: string }) {
  const { data, error, loading } = useResource<CompilationList>(
    `/compilations${qs({ branch, limit: 100 })}`,
  );
  const rows = data?.compilations ?? [];

  return (
    <div className="view">
      <header className="view-head">
        <div>
          <h1 className="view-title">History</h1>
          <p className="view-sub">
            Every projection of <code>{branch}</code> into the index — newest first.
          </p>
        </div>
      </header>

      <Status loading={loading && !data} error={error} empty={rows.length === 0}>
        <EmptyState
          title="Nothing compiled yet"
          body={
            <>
              This branch has never been projected. Compile from Overview, or run{" "}
              <code>graft compile</code>.
            </>
          }
        />
      </Status>

      {rows.length > 0 ? (
        <table className="table">
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
              <tr key={row.id}>
                <td>{row.gitSha ? <code>{shortSha(row.gitSha)}</code> : <span className="muted">no git sha</span>}</td>
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
    </div>
  );
}
