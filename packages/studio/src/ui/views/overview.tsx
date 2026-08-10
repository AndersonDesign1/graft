import type { ApprovalList, BranchList, CompilationList, ContentTree } from "../../types";
import {
  Delta,
  DeltaChart,
  EmptyState,
  IdentityMark,
  StatTile,
  Status,
} from "../components/primitives";
import { ChartSkeleton, MiniListSkeleton, OverviewSkeleton } from "../components/skeletons";
import { qs } from "../lib/api";
import { relativeTime, shortSha, plural } from "../lib/format";
import type { Route } from "../lib/route";
import { useResource } from "../lib/use-resource";

// Compiling is not this view's job any more — the top bar owns that control, so
// the props that drove the removed banner are gone with it.
export function OverviewView({
  branch,
  tree,
  navigate,
}: {
  branch: string;
  tree: { data: ContentTree | null; error: string | null; loading: boolean };
  navigate: (route: Route) => void;
}) {
  const compilations = useResource<CompilationList>(`/compilations${qs({ branch, limit: 30 })}`);
  const approvals = useResource<ApprovalList>("/approvals");
  const branches = useResource<BranchList>("/branches");

  const summary = tree.data?.summary;
  const neverCompiled = (compilations.data?.compilations.length ?? 0) === 0;
  const pending = approvals.data?.approvals.length ?? 0;

  return (
    <div className="view">
      <header className="view-head">
        <div>
          <h1 className="view-title">Overview</h1>
          <p className="view-sub">
            Branch <code>{branch}</code> — content on disk, and what the index knows about it.
          </p>
        </div>
      </header>

      <Status
        loading={tree.loading && !tree.data}
        error={tree.error}
        skeleton={<OverviewSkeleton />}
      />

      {tree.data ? (
        <>
          {/* No sync banner here. It said the same thing as the "N changes to
              compile" control in the top bar — which is always on screen, on
              every view, and runs the same compile — and then repeated the
              breakdown that the stat tiles directly below already give as
              numbers. Three copies of one fact pushed the actual dashboard
              below the fold. The tiles are the breakdown; the top bar is the
              call to action. */}
          <section className="tiles">
            <StatTile
              label="On disk"
              value={summary?.documents ?? 0}
              hint={plural(tree.data.collections.length, "collection")}
            />
            <StatTile label="In sync" value={summary?.synced ?? 0} tone="synced" />
            <StatTile label="Drifted" value={summary?.drifted ?? 0} tone="drifted" />
            <StatTile label="Not indexed" value={summary?.unindexed ?? 0} tone="unindexed" />
            <StatTile label="Orphaned" value={summary?.orphaned ?? 0} tone="orphaned" />
            <StatTile
              label="Approvals"
              value={pending}
              hint={pending > 0 ? "waiting on you" : "queue clear"}
            />
          </section>

          <div className="cards">
            <section className="card">
              <div className="card-head">
                <h2>Collections</h2>
                <button
                  type="button"
                  className="link"
                  onClick={() => navigate({ view: "collections" })}
                >
                  Browse
                </button>
              </div>
              <ul className="mini-list">
                {tree.data.collections.map((collection) => (
                  <li key={collection.name}>
                    <button
                      type="button"
                      className="mini-row"
                      onClick={() => navigate({ view: "collections", collection: collection.name })}
                    >
                      <IdentityMark name={collection.name} />
                      <span className="mini-row-main">
                        <span className="mini-row-title">{collection.name}</span>
                        <span className="mini-row-sub">
                          {collection.authority === "db"
                            ? "db-authoritative — rows, not files"
                            : collection.error
                              ? collection.error
                              : `${plural(collection.documents.length, "document")}${
                                  collection.driftCount > 0
                                    ? ` · ${collection.driftCount} out of sync`
                                    : ""
                                }`}
                        </span>
                      </span>
                      {collection.authority === "file" && collection.driftCount > 0 ? (
                        <span className="dot" data-state="drifted" />
                      ) : collection.authority === "file" && collection.documents.length > 0 ? (
                        <span className="dot" data-state="synced" />
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            </section>

            <section className="card">
              <div className="card-head">
                <h2>Compilations</h2>
                <button
                  type="button"
                  className="link"
                  onClick={() => navigate({ view: "history" })}
                >
                  History
                </button>
              </div>
              <Status
                loading={compilations.loading && !compilations.data}
                error={compilations.error}
                empty={neverCompiled}
                skeleton={<ChartSkeleton />}
              >
                <p className="muted">Nothing compiled on this branch yet.</p>
              </Status>
              {!neverCompiled && compilations.data ? (
                <>
                  <DeltaChart
                    points={[...compilations.data.compilations].reverse().map((row) => ({
                      added: row.added,
                      changed: row.changed,
                      removed: row.removed,
                      label: relativeTime(row.createdAt),
                    }))}
                  />
                  <ul className="mini-list">
                    {compilations.data.compilations.slice(0, 5).map((row) => (
                      <li key={row.id}>
                        <div className="mini-row" data-static="">
                          <span className="mini-row-main">
                            <span className="mini-row-title">
                              {row.gitSha ? <code>{shortSha(row.gitSha)}</code> : "no git sha"}
                            </span>
                            <span className="mini-row-sub">{plural(row.docCount, "document")}</span>
                          </span>
                          <Delta added={row.added} changed={row.changed} removed={row.removed} />
                          <time className="mini-row-time" dateTime={row.createdAt}>
                            {relativeTime(row.createdAt)}
                          </time>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </section>

            <section className="card">
              <div className="card-head">
                <h2>Approvals</h2>
                <button
                  type="button"
                  className="link"
                  onClick={() => navigate({ view: "approvals" })}
                >
                  Queue
                </button>
              </div>
              <Status
                loading={approvals.loading && !approvals.data}
                error={approvals.error}
                empty={pending === 0}
                skeleton={<MiniListSkeleton rows={3} />}
              >
                <p className="muted">No agent is waiting on a decision.</p>
              </Status>
              {pending > 0 ? (
                <ul className="mini-list">
                  {approvals.data?.approvals.slice(0, 4).map((row) => (
                    <li key={row.id}>
                      <button
                        type="button"
                        className="mini-row"
                        onClick={() => navigate({ view: "approvals" })}
                      >
                        <span className="mini-row-main">
                          <span className="mini-row-title">{row.functionName}</span>
                          <span className="mini-row-sub">
                            {row.requestedByKind}
                            {row.requestedById ? `:${row.requestedById}` : ""}
                          </span>
                        </span>
                        <time className="mini-row-time" dateTime={row.createdAt}>
                          {relativeTime(row.createdAt)}
                        </time>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>

            <section className="card">
              <div className="card-head">
                <h2>Branches</h2>
                <button
                  type="button"
                  className="link"
                  onClick={() => navigate({ view: "branches" })}
                >
                  All
                </button>
              </div>
              <Status
                loading={branches.loading && !branches.data}
                error={branches.error}
                empty={(branches.data?.branches.length ?? 0) === 0}
                skeleton={<MiniListSkeleton rows={3} />}
              >
                <p className="muted">No branches registered — only the default.</p>
              </Status>
              <ul className="mini-list">
                {branches.data?.branches.slice(0, 5).map((row) => (
                  <li key={row.name}>
                    <div className="mini-row" data-static="" data-current={row.name === branch}>
                      <span className="mini-row-main">
                        <span className="mini-row-title">{row.name}</span>
                        <span className="mini-row-sub">
                          {row.backend}
                          {row.parent ? ` ← ${row.parent}` : " · root"}
                        </span>
                      </span>
                      <span className="pill" data-tone="ready">
                        {row.status}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </>
      ) : null}

      {!tree.loading && !tree.error && (tree.data?.collections.length ?? 0) === 0 ? (
        <EmptyState
          title="No collections registered"
          body={
            <>
              Define one with <code>defineCollection</code> in <code>graft.config.ts</code>, then
              author documents under <code>content/&lt;collection&gt;/</code>.
            </>
          }
        />
      ) : null}
    </div>
  );
}
