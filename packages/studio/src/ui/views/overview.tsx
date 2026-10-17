/**
 * Health: content on disk against what the index knows, for one branch.
 *
 * A developer's page. The numbers are the point, so they lead, without boxes
 * around them; a number takes a hue only when it needs someone (amber) or
 * something is broken (red). Below them, plain lists: collections, recent
 * compiles, approvals and branches. Out-of-date content is fixed from here
 * with Compile, rather than by sending someone to a terminal.
 */
import { useState } from "react";
import { toast } from "sonner";
import type { ApprovalList, BranchList, CompilationList, ContentTree } from "../../types";
import { CollectionMark } from "../components/collection-icon";
import { IconCompile } from "../components/icons";
import { Delta, EmptyState, NeedsDatabase, Status } from "../components/primitives";
import { MiniListSkeleton, OverviewSkeleton } from "../components/skeletons";
import { api, plainError, qs } from "../lib/api";
import { relativeTime, shortSha, plural } from "../lib/format";
import type { Route } from "../lib/route";
import { useStudio } from "../lib/studio";
import { useResource } from "../lib/use-resource";

interface CompileResult {
  added: number;
  changed: number;
  removed: number;
  docCount: number;
}

export function OverviewView({
  branch,
  tree,
  navigate,
  canWrite,
}: {
  branch: string;
  /** A viewer can read Health but not compile: POST /compile needs studio:write. */
  canWrite: boolean;
  tree: { data: ContentTree | null; error: string | null; loading: boolean; refresh: () => void };
  navigate: (route: Route) => void;
}) {
  const { workspace } = useStudio();
  const database = workspace.data?.database;
  // Without an index, compiling has nowhere to write: Postgres or the static artifact.
  const indexed = workspace.data?.index !== "none";
  const onlyWith = (path: string): string | null => (database ? path : null);
  const compilations = useResource<CompilationList>(
    onlyWith(`/compilations${qs({ branch, limit: 10 })}`),
    [database],
  );
  const approvals = useResource<ApprovalList>(onlyWith("/approvals"), [database]);
  const branches = useResource<BranchList>(onlyWith("/branches"), [database]);
  const [compiling, setCompiling] = useState(false);

  const summary = tree.data?.summary;
  const noIndex = tree.data?.index === "none";
  const pending = approvals.data?.approvals.length ?? 0;
  const runs = compilations.data?.compilations ?? [];

  async function compileNow(): Promise<void> {
    setCompiling(true);
    try {
      const result = await api<CompileResult>("/compile", {
        method: "POST",
        body: JSON.stringify({ branch }),
      });
      toast.success(`Compiled ${plural(result.docCount, "entry", "entries")}`, {
        description: `${result.added} added, ${result.changed} changed, ${result.removed} removed`,
      });
      tree.refresh();
      compilations.refresh();
    } catch (error) {
      toast.error(plainError(error));
    } finally {
      setCompiling(false);
    }
  }

  return (
    <div className="view">
      <header className="view-head">
        <div>
          <h1 className="view-title">Health</h1>
          <p className="view-sub">
            {workspace.data?.index === "none" ? (
              <>
                Content on disk on <code>{branch}</code>. There is no index to compare it with: this
                Studio runs without a database.
              </>
            ) : workspace.data?.index === "static" ? (
              <>
                Content on disk, and what the static index (<code>.graft/index.db</code>) knows
                about it.
              </>
            ) : (
              <>
                Content on disk on <code>{branch}</code>, and what the index knows about it.
              </>
            )}
          </p>
        </div>
        <button
          type="button"
          className="btn"
          disabled={compiling || !canWrite || !indexed}
          onClick={() => void compileNow()}
          title={
            !indexed
              ? "Compiling needs an index: a database, or the static index"
              : canWrite
                ? undefined
                : "Compiling needs write access"
          }
        >
          <IconCompile aria-hidden="true" />
          {compiling ? "Compiling…" : "Compile"}
        </button>
      </header>

      <Status
        loading={tree.loading && !tree.data}
        error={tree.error}
        skeleton={<OverviewSkeleton />}
      />

      {tree.data ? (
        <>
          <dl className="stats">
            <div className="stat">
              <dt>On disk</dt>
              <dd data-numeric="">{summary?.documents ?? 0}</dd>
            </div>
            {/* With no index there is nothing to be in or out of date with. */}
            {noIndex ? null : (
              <>
                <div className="stat">
                  <dt>In the index</dt>
                  <dd data-numeric="">{summary?.synced ?? 0}</dd>
                </div>
                <div className="stat">
                  <dt>Out of date</dt>
                  <dd data-numeric="">{summary?.drifted ?? 0}</dd>
                </div>
                <div className="stat">
                  <dt>Not indexed</dt>
                  <dd data-numeric="">{summary?.unindexed ?? 0}</dd>
                </div>
                <div
                  className="stat"
                  data-tone={(summary?.orphaned ?? 0) > 0 ? "danger" : undefined}
                >
                  <dt>File missing</dt>
                  <dd data-numeric="">{summary?.orphaned ?? 0}</dd>
                </div>
              </>
            )}
            {approvals.data ? (
              <div className="stat" data-tone={pending > 0 ? "waiting" : undefined}>
                <dt>Waiting for approval</dt>
                <dd data-numeric="">{pending}</dd>
              </div>
            ) : null}
          </dl>

          <section className="health-section" aria-labelledby="health-collections">
            <h2 className="section-title" id="health-collections">
              Collections
            </h2>
            <table className="list">
              <thead>
                <tr>
                  <th scope="col">Collection</th>
                  <th scope="col">Stored as</th>
                  <th scope="col">State</th>
                  <th scope="col" data-align="end">
                    Entries
                  </th>
                </tr>
              </thead>
              <tbody>
                {tree.data.collections.map((collection) => (
                  <tr
                    key={collection.name}
                    className="list-row"
                    onClick={() => navigate({ view: "collection", collection: collection.name })}
                  >
                    <td>
                      <a
                        className="list-name"
                        href={`#/c/${encodeURIComponent(collection.name)}`}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <CollectionMark
                          name={collection.name}
                          authority={collection.authority === "db" ? "db" : "file"}
                        />
                        <code>{collection.name}</code>
                      </a>
                    </td>
                    <td className="muted">
                      {collection.authority === "db" ? "Database rows" : "MDX files"}
                    </td>
                    <td>
                      {collection.error ? (
                        <span className="row-state" data-status="deleted">
                          {collection.error}
                        </span>
                      ) : noIndex ? (
                        <span className="muted">No index</span>
                      ) : collection.authority === "file" && collection.driftCount > 0 ? (
                        <span className="row-state" data-status="changed">
                          {collection.driftCount} out of date
                        </span>
                      ) : (
                        <span className="muted">In sync</span>
                      )}
                    </td>
                    <td data-align="end" data-numeric="">
                      {collection.documents.length}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {database ? (
            <>
              <section className="health-section" aria-labelledby="health-compiles">
                <div className="section-head">
                  <h2 className="section-title" id="health-compiles">
                    Recent compiles
                  </h2>
                  <a className="link" href="#/dev/history">
                    History
                  </a>
                </div>
                <Status
                  loading={compilations.loading && !compilations.data}
                  error={compilations.error}
                  empty={runs.length === 0}
                  skeleton={<MiniListSkeleton rows={3} />}
                >
                  <p className="muted">Nothing compiled on this branch yet.</p>
                </Status>
                {runs.length > 0 ? (
                  <table className="list">
                    <thead>
                      <tr>
                        <th scope="col">Commit</th>
                        <th scope="col">Changes</th>
                        <th scope="col" data-align="end">
                          Entries
                        </th>
                        <th scope="col" data-align="end">
                          When
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {runs.slice(0, 5).map((row) => (
                        <tr key={row.id}>
                          <td>{row.gitSha ? <code>{shortSha(row.gitSha)}</code> : "Not in Git"}</td>
                          <td>
                            <Delta added={row.added} changed={row.changed} removed={row.removed} />
                          </td>
                          <td data-align="end" data-numeric="">
                            {row.docCount}
                          </td>
                          <td data-align="end">
                            <time dateTime={row.createdAt}>{relativeTime(row.createdAt)}</time>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
              </section>

              {approvals.error ? (
                <section className="health-section" aria-labelledby="health-approvals">
                  <h2 className="section-title" id="health-approvals">
                    Waiting for approval
                  </h2>
                  <Status loading={false} error={approvals.error} />
                </section>
              ) : pending > 0 ? (
                <section className="health-section" aria-labelledby="health-approvals">
                  <div className="section-head">
                    <h2 className="section-title" id="health-approvals">
                      Waiting for approval
                    </h2>
                    <a className="link" href="#/inbox">
                      Review
                    </a>
                  </div>
                  <table className="list">
                    <tbody>
                      {approvals.data?.approvals.slice(0, 4).map((row) => (
                        <tr
                          key={row.id}
                          className="list-row"
                          onClick={() => navigate({ view: "inbox" })}
                        >
                          <td>
                            <a
                              className="list-name"
                              href="#/inbox"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <code>{row.functionName}</code>
                            </a>
                          </td>
                          <td className="muted">
                            {row.requestedByKind}
                            {row.requestedById ? `: ${row.requestedById}` : ""}
                          </td>
                          <td data-align="end">
                            <time dateTime={row.createdAt}>{relativeTime(row.createdAt)}</time>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              ) : null}

              <section className="health-section" aria-labelledby="health-branches">
                <div className="section-head">
                  <h2 className="section-title" id="health-branches">
                    Branches
                  </h2>
                  <a className="link" href="#/dev/branches">
                    All branches
                  </a>
                </div>
                <Status
                  loading={branches.loading && !branches.data}
                  error={branches.error}
                  empty={(branches.data?.branches.length ?? 0) === 0}
                  skeleton={<MiniListSkeleton rows={3} />}
                >
                  <p className="muted">No branches registered, only the default.</p>
                </Status>
                {(branches.data?.branches.length ?? 0) > 0 ? (
                  <table className="list">
                    <tbody>
                      {branches.data?.branches.slice(0, 5).map((row) => (
                        <tr key={row.name}>
                          <td>
                            <code>{row.name}</code>
                            {row.name === branch ? <span className="muted"> (current)</span> : null}
                          </td>
                          <td className="muted">
                            {row.backend}
                            {row.parent ? `, from ${row.parent}` : ", root"}
                          </td>
                          <td data-align="end" className="muted">
                            {row.status}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
              </section>
            </>
          ) : database === false ? (
            <section className="health-section">
              <NeedsDatabase
                title="Compile history, approvals and branches need a database"
                does="Postgres keeps a record of every compile, the requests agents make before a destructive change, and the branches you preview content on."
              />
            </section>
          ) : null}
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
