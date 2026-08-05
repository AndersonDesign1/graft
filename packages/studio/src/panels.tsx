/**
 * Graft Studio dashboard — rail + three-pane content editor.
 * React SPA client of the OpenAPI HTTP surface (not Astro).
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  ApprovalList,
  BranchList,
  CompilationList,
  ContentTree,
  ContentTreeCollection,
  DocumentDto,
  PendingApprovalDto,
} from "./types";

type NavId = "content" | "approvals" | "branches" | "compilations";
type EditorMode = "fields" | "raw";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = (await res.json().catch(() => null)) as
    | (T & { message?: string; error?: string; fix?: string })
    | null;
  if (!res.ok) {
    throw new Error(body?.message ?? body?.fix ?? `${res.status} ${res.statusText}`);
  }
  return body as T;
}

function useResource<T>(path: string, refreshKey = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api<T>(path)
      .then((value) => {
        if (!cancelled) setData(value);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, refreshKey]);
  return { data, error, loading };
}

function Status({
  error,
  loading,
  empty,
}: {
  error?: string | null;
  loading?: boolean;
  empty?: string;
}) {
  if (error) return <p className="panel-error">{error}</p>;
  if (loading) return <p className="panel-empty">Loading…</p>;
  if (empty) return <p className="panel-empty">{empty}</p>;
  return null;
}

function scalarEntries(data: Record<string, unknown>): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out.push([key, String(value)]);
    }
  }
  // Prefer familiar fields first.
  const order = ["title", "description", "section", "order", "tagline"];
  out.sort((a, b) => {
    const ai = order.indexOf(a[0]);
    const bi = order.indexOf(b[0]);
    if (ai === -1 && bi === -1) return a[0].localeCompare(b[0]);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
  return out;
}

function buildRaw(data: Record<string, unknown>, body: string): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string") {
      const needsQuote = value.includes(":") || value.includes("#") || value.includes("\n");
      lines.push(needsQuote ? `${key}: ${JSON.stringify(value)}` : `${key}: ${value}`);
    } else if (typeof value === "number" || typeof value === "boolean") {
      lines.push(`${key}: ${value}`);
    }
    // Complex values stay as-is via server raw path when using Raw mode.
  }
  lines.push("---", "");
  return `${lines.join("\n")}${body.replace(/^\n/, "")}`;
}

export function ContentWorkspace({ branch }: { branch: string }) {
  const [refresh, setRefresh] = useState(0);
  const { data: tree, error, loading } = useResource<ContentTree>(
    `/api/studio/v1/tree?branch=${encodeURIComponent(branch)}`,
    refresh,
  );
  const [collectionName, setCollectionName] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ collection: string; slug: string } | null>(null);
  const [doc, setDoc] = useState<DocumentDto | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [body, setBody] = useState("");
  const [raw, setRaw] = useState("");
  const [mode, setMode] = useState<EditorMode>("fields");
  const [query, setQuery] = useState("");
  const [docError, setDocError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!tree?.collections.length) return;
    if (collectionName && tree.collections.some((c) => c.name === collectionName)) return;
    setCollectionName(tree.collections[0]?.name ?? null);
  }, [tree, collectionName]);

  const activeCollection: ContentTreeCollection | undefined = tree?.collections.find(
    (c) => c.name === collectionName,
  );

  const filteredDocs = useMemo(() => {
    const docs = activeCollection?.documents ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return docs;
    return docs.filter(
      (d) =>
        d.slug.toLowerCase().includes(q) ||
        d.sourcePath.toLowerCase().includes(q) ||
        (d.title?.toLowerCase().includes(q) ?? false),
    );
  }, [activeCollection, query]);

  const openDoc = useCallback(async (collection: string, slug: string) => {
    setSelected({ collection, slug });
    setDocError(null);
    setSaveMsg(null);
    try {
      const next = await api<DocumentDto>(
        `/api/studio/v1/document?collection=${encodeURIComponent(collection)}&slug=${encodeURIComponent(slug)}`,
      );
      setDoc(next);
      setRaw(next.raw);
      setBody(next.body);
      const nextFields: Record<string, string> = {};
      for (const [key, value] of scalarEntries(next.data)) nextFields[key] = value;
      setFields(nextFields);
    } catch (err) {
      setDoc(null);
      setRaw("");
      setBody("");
      setFields({});
      setDocError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  async function save() {
    if (!selected || !doc) return;
    setSaving(true);
    setDocError(null);
    setSaveMsg(null);
    try {
      let payload: Record<string, unknown>;
      if (mode === "raw") {
        payload = {
          collection: selected.collection,
          slug: selected.slug,
          raw,
          branch,
        };
      } else {
        const data: Record<string, unknown> = { ...doc.data };
        for (const [key, value] of Object.entries(fields)) {
          const prev = doc.data[key];
          if (typeof prev === "number" && value.trim() !== "" && !Number.isNaN(Number(value))) {
            data[key] = Number(value);
          } else if (typeof prev === "boolean") {
            data[key] = value === "true";
          } else {
            data[key] = value;
          }
        }
        payload = {
          collection: selected.collection,
          slug: selected.slug,
          data,
          body,
          branch,
        };
      }
      const result = await api<{ written: string; gitSha: string | null }>("/api/studio/v1/document", {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      setSaveMsg(`Saved ${result.written}${result.gitSha ? ` @ ${result.gitSha.slice(0, 7)}` : ""}`);
      setRefresh((n) => n + 1);
      await openDoc(selected.collection, selected.slug);
    } catch (err) {
      setDocError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function switchMode(next: EditorMode) {
    if (next === mode) return;
    if (next === "raw" && doc) {
      const data: Record<string, unknown> = { ...doc.data };
      for (const [key, value] of Object.entries(fields)) {
        const prev = doc.data[key];
        if (typeof prev === "number" && value.trim() !== "" && !Number.isNaN(Number(value))) {
          data[key] = Number(value);
        } else if (typeof prev === "boolean") {
          data[key] = value === "true";
        } else {
          data[key] = value;
        }
      }
      setRaw(buildRaw(data, body));
    }
    setMode(next);
  }

  const displayTitle =
    fields.title || selected?.slug || (doc ? String(doc.data.title ?? selected?.slug) : "Untitled");

  return (
    <div className="content-panes">
      <section className="pane">
        <div className="pane-head">
          <h2 className="pane-title">Collections</h2>
        </div>
        <div className="pane-scroll">
          <Status
            error={error}
            loading={loading}
            empty={
              !loading && !error && (tree?.collections.length ?? 0) === 0
                ? "No collections — check graft.config.ts."
                : undefined
            }
          />
          {tree?.collections.map((collection) => (
            <button
              key={collection.name}
              type="button"
              className={`list-btn${collection.name === collectionName ? " active" : ""}`}
              onClick={() => {
                setCollectionName(collection.name);
                setQuery("");
              }}
            >
              <span className="list-btn-main">
                <span className="list-btn-title">{collection.name}</span>
                {collection.description ? (
                  <span className="list-btn-sub">{collection.description}</span>
                ) : null}
              </span>
              <span className="list-count">{collection.documents.length}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="pane">
        <div className="pane-head">
          <h2 className="pane-title">{activeCollection?.name ?? "Documents"}</h2>
          <input
            className="pane-search"
            placeholder="Search list"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search documents"
          />
        </div>
        <div className="pane-scroll">
          <Status
            empty={
              !loading && activeCollection && filteredDocs.length === 0
                ? query
                  ? "No matches."
                  : "No documents in this collection."
                : undefined
            }
          />
          {filteredDocs.map((d) => {
            const active = selected?.collection === collectionName && selected.slug === d.slug;
            return (
              <button
                key={d.slug}
                type="button"
                className={`list-btn${active ? " active" : ""}`}
                onClick={() => collectionName && void openDoc(collectionName, d.slug)}
              >
                <span className="list-btn-main">
                  <span className="list-btn-title">{d.title ?? d.slug}</span>
                  <span className="list-btn-sub">{d.sourcePath}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="pane">
        <div className="editor">
          {!selected ? (
            <p className="panel-empty">Select a document to edit.</p>
          ) : (
            <>
              <div className="editor-toolbar">
                <div>
                  <h2 className="editor-display">{displayTitle}</h2>
                  <div className="editor-path">{doc?.sourcePath ?? "…"}</div>
                </div>
                <div className="editor-actions">
                  <div className="mode-toggle" role="group" aria-label="Editor mode">
                    <button
                      type="button"
                      className={mode === "fields" ? "active" : ""}
                      onClick={() => switchMode("fields")}
                    >
                      Fields
                    </button>
                    <button
                      type="button"
                      className={mode === "raw" ? "active" : ""}
                      onClick={() => switchMode("raw")}
                    >
                      Raw
                    </button>
                  </div>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={saving || !doc}
                    onClick={() => void save()}
                  >
                    {saving ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
              {docError ? <p className="panel-error">{docError}</p> : null}
              {saveMsg ? <p className="panel-ok">{saveMsg}</p> : null}
              <div className="editor-scroll">
                {mode === "fields" ? (
                  <>
                    <div className="field-grid">
                      {Object.keys(fields).length === 0 ? (
                        <p className="panel-hint">No scalar frontmatter fields — edit body below.</p>
                      ) : (
                        Object.entries(fields).map(([key, value]) => (
                          <div key={key} className="field">
                            <label htmlFor={`field-${key}`}>{key}</label>
                            {key === "description" || value.length > 80 ? (
                              <textarea
                                id={`field-${key}`}
                                rows={3}
                                value={value}
                                onChange={(e) =>
                                  setFields((prev) => ({ ...prev, [key]: e.target.value }))
                                }
                              />
                            ) : (
                              <input
                                id={`field-${key}`}
                                value={value}
                                onChange={(e) =>
                                  setFields((prev) => ({ ...prev, [key]: e.target.value }))
                                }
                              />
                            )}
                          </div>
                        ))
                      )}
                    </div>
                    <div className="field field-body">
                      <label htmlFor="field-body">Body</label>
                      <textarea
                        id="field-body"
                        className="editor-area"
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                        spellCheck={false}
                        aria-label="Document body"
                      />
                    </div>
                  </>
                ) : (
                  <textarea
                    className="editor-area"
                    value={raw}
                    onChange={(e) => setRaw(e.target.value)}
                    spellCheck={false}
                    aria-label="Raw MDX source"
                  />
                )}
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

export function ApprovalQueuePanel() {
  const [refresh, setRefresh] = useState(0);
  const { data, error, loading } = useResource<ApprovalList>("/api/studio/v1/approvals", refresh);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function decide(row: PendingApprovalDto, decision: "approved" | "denied") {
    setBusy(row.id);
    setActionError(null);
    setMsg(null);
    try {
      await api(`/api/studio/v1/approvals/${encodeURIComponent(row.id)}/decide`, {
        method: "POST",
        body: JSON.stringify({ decision }),
      });
      setMsg(`${decision}: ${row.functionName}`);
      setRefresh((n) => n + 1);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="pane-pad">
      <h2 className="pane-title">Approvals</h2>
      <p className="panel-hint">
        Destructive calls wait here. Approve so the agent can retry; deny to refuse.
      </p>
      <Status
        error={error ?? actionError}
        loading={loading}
        empty={
          !loading && !error && data?.approvals.length === 0 ? "No pending approvals." : undefined
        }
      />
      {msg ? <p className="panel-ok">{msg}</p> : null}
      {data?.approvals.map((row) => (
        <article key={row.id} className="approval-card">
          <div className="approval-head">
            <div>
              <div className="row-title">{row.functionName}</div>
              <div className="row-sub">
                {row.id} · {row.requestedByKind}
                {row.requestedById ? `:${row.requestedById}` : ""} · branch {row.branchId}
              </div>
            </div>
            <span className="status-pill pending">Pending</span>
          </div>
          <pre className="approval-input">{JSON.stringify(row.input, null, 2)}</pre>
          <div className="btn-row">
            <button
              type="button"
              className="btn ok"
              disabled={busy === row.id}
              onClick={() => void decide(row, "approved")}
            >
              Approve
            </button>
            <button
              type="button"
              className="btn danger"
              disabled={busy === row.id}
              onClick={() => void decide(row, "denied")}
            >
              Deny
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

export function BranchListPanel({
  branch,
  onSelectBranch,
}: {
  branch: string;
  onSelectBranch?: (name: string) => void;
}) {
  const { data, error, loading } = useResource<BranchList>("/api/studio/v1/branches");
  return (
    <div className="pane-pad">
      <h2 className="pane-title">Branches</h2>
      <p className="panel-hint">Click a branch to browse its content tree.</p>
      <Status
        error={error}
        loading={loading}
        empty={!loading && !error && data?.branches.length === 0 ? "No branches registered." : undefined}
      />
      {data?.branches.map((row) => (
        <button
          key={row.name}
          type="button"
          className={`row-btn${row.name === branch ? " active" : ""}`}
          onClick={() => onSelectBranch?.(row.name)}
        >
          <div className="row-main">
            <div className="row-title">{row.name}</div>
            <div className="row-sub">
              {row.backend}
              {row.parent ? ` ← ${row.parent}` : " (root)"}
            </div>
          </div>
          <span className="status-pill ready">{row.status}</span>
        </button>
      ))}
    </div>
  );
}

export function CompilationTrailPanel({ branch }: { branch?: string }) {
  const qs = branch ? `?branch=${encodeURIComponent(branch)}&limit=40` : "?limit=40";
  const { data, error, loading } = useResource<CompilationList>(`/api/studio/v1/compilations${qs}`);
  return (
    <div className="pane-pad">
      <h2 className="pane-title">Compilations</h2>
      <p className="panel-hint">Projection trail — newest first.</p>
      <Status
        error={error}
        loading={loading}
        empty={
          !loading && !error && data?.compilations.length === 0
            ? "No compilations yet — save a document or run graft compile."
            : undefined
        }
      />
      {data?.compilations.map((row) => (
        <div key={row.id} className="row">
          <div className="row-main">
            <div className="row-title">
              {row.branchId}
              {row.gitSha ? ` @ ${row.gitSha.slice(0, 7)}` : ""}
            </div>
            <div className="row-sub">
              <span className="delta-add">+{row.added}</span>{" "}
              <span className="delta-change">~{row.changed}</span>{" "}
              <span className="delta-remove">−{row.removed}</span> · {row.docCount} docs
            </div>
          </div>
          <div className="row-meta">{new Date(row.createdAt).toLocaleString()}</div>
        </div>
      ))}
    </div>
  );
}

const NAV: Array<{ id: NavId; label: string }> = [
  { id: "content", label: "Content" },
  { id: "approvals", label: "Approvals" },
  { id: "branches", label: "Branches" },
  { id: "compilations", label: "Compilations" },
];

export function StudioApp({ branch: initialBranch = "main" }: { branch?: string }) {
  const [nav, setNav] = useState<NavId>("content");
  const [branch, setBranch] = useState(initialBranch);

  let main: ReactNode;
  if (nav === "content") main = <ContentWorkspace branch={branch} />;
  else if (nav === "approvals") main = <ApprovalQueuePanel />;
  else if (nav === "branches")
    main = (
      <BranchListPanel
        branch={branch}
        onSelectBranch={(name) => {
          setBranch(name);
          setNav("content");
        }}
      />
    );
  else main = <CompilationTrailPanel branch={branch} />;

  return (
    <div className="studio">
      <header className="studio-header">
        <div className="studio-brand">
          graft<b>.</b> studio
        </div>
        <div className="studio-header-right">
          <span className="chip chip-branch">{branch}</span>
          <span className="chip chip-muted">opt-in</span>
          <span className="chip chip-muted">openapi</span>
        </div>
      </header>
      <div className="studio-body">
        <nav className="sidebar" aria-label="Studio">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`nav-btn${nav === item.id ? " active" : ""}`}
              onClick={() => setNav(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <main className="main">{main}</main>
      </div>
    </div>
  );
}

/** Embed export — full content workspace. */
export function ContentTreePanel({ branch = "main" }: { branch?: string }) {
  return <ContentWorkspace branch={branch} />;
}
