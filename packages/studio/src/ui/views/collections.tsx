import { useCallback, useEffect, useMemo, useState } from "react";
import type { ContentTree, ContentTreeCollection, DocumentDto, DocumentState } from "../../types";
import { IconDatabase, IconFile, IconSearch } from "../components/icons";
import {
  Button,
  EmptyState,
  IdentityMark,
  Pill,
  StatePill,
  StatusDot,
  Status,
  STATE_LABEL,
} from "../components/primitives";
import { api, qs } from "../lib/api";
import { relativeTime } from "../lib/format";
import type { Route } from "../lib/route";

type EditorMode = "fields" | "raw";
type Filter = "all" | "drifted" | "unindexed";

/** Only string/number/boolean frontmatter is editable as a field. */
function scalarEntries(data: Record<string, unknown>): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out.push([key, String(value)]);
    }
  }
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
  }
  lines.push("---", "");
  return `${lines.join("\n")}${body.replace(/^\n/, "")}`;
}

/** Coerce edited strings back to the type the original frontmatter used. */
function mergeFields(
  original: Record<string, unknown>,
  fields: Record<string, string>,
): Record<string, unknown> {
  const data: Record<string, unknown> = { ...original };
  for (const [key, value] of Object.entries(fields)) {
    const prev = original[key];
    if (typeof prev === "number" && value.trim() !== "" && !Number.isNaN(Number(value))) {
      data[key] = Number(value);
    } else if (typeof prev === "boolean") {
      data[key] = value === "true";
    } else {
      data[key] = value;
    }
  }
  return data;
}

export function CollectionsView({
  branch,
  route,
  navigate,
  tree,
  onSaved,
}: {
  branch: string;
  route: Route;
  navigate: (route: Route) => void;
  tree: { data: ContentTree | null; error: string | null; loading: boolean; refresh: () => void };
  onSaved: () => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [doc, setDoc] = useState<DocumentDto | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [body, setBody] = useState("");
  const [raw, setRaw] = useState("");
  const [mode, setMode] = useState<EditorMode>("fields");
  const [docError, setDocError] = useState<string | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const collections = tree.data?.collections ?? [];
  const active: ContentTreeCollection | undefined =
    collections.find((c) => c.name === route.collection) ?? collections[0];

  // Keep the URL honest once the tree resolves, so reloads land in the same place.
  useEffect(() => {
    if (!route.collection && active) {
      navigate({ view: "collections", collection: active.name });
    }
  }, [active, route.collection, navigate]);

  const docs = useMemo(() => {
    const list = active?.documents ?? [];
    const q = query.trim().toLowerCase();
    return list.filter((d) => {
      if (filter === "drifted" && d.state === "synced") return false;
      if (filter === "unindexed" && d.state !== "unindexed") return false;
      if (!q) return true;
      return (
        d.slug.toLowerCase().includes(q) ||
        d.sourcePath.toLowerCase().includes(q) ||
        (d.title?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [active, query, filter]);

  const openDoc = useCallback(
    async (collection: string, slug: string) => {
      setDocError(null);
      setSaveMsg(null);
      setDocLoading(true);
      setDirty(false);
      try {
        const next = await api<DocumentDto>(`/document${qs({ collection, slug })}`);
        setDoc(next);
        setRaw(next.raw);
        setBody(next.body);
        setFields(Object.fromEntries(scalarEntries(next.data)));
      } catch (err) {
        setDoc(null);
        setRaw("");
        setBody("");
        setFields({});
        setDocError(err instanceof Error ? err.message : String(err));
      } finally {
        setDocLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (route.collection && route.slug) void openDoc(route.collection, route.slug);
    else setDoc(null);
  }, [route.collection, route.slug, openDoc]);

  const selectedState: DocumentState | undefined = active?.documents.find(
    (d) => d.slug === route.slug,
  )?.state;

  const save = useCallback(async () => {
    if (!route.collection || !route.slug || !doc) return;
    setSaving(true);
    setDocError(null);
    setSaveMsg(null);
    try {
      const payload =
        mode === "raw"
          ? { collection: route.collection, slug: route.slug, raw, branch }
          : {
              collection: route.collection,
              slug: route.slug,
              data: mergeFields(doc.data, fields),
              body,
              branch,
            };
      const result = await api<{ written: string; gitSha: string | null }>("/document", {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      // Save recompiles, so the document lands `synced` — say so rather than
      // echoing a bare path.
      setSaveMsg(
        `Saved ${result.written} · index updated${result.gitSha ? ` @ ${result.gitSha.slice(0, 7)}` : ""}`,
      );
      setDirty(false);
      onSaved();
      await openDoc(route.collection, route.slug);
    } catch (err) {
      setDocError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [route.collection, route.slug, doc, mode, raw, fields, body, branch, onSaved, openDoc]);

  // ⌘S / Ctrl+S — the shortcut anyone editing text will reach for first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (dirty && !saving) void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, saving, save]);

  function switchMode(next: EditorMode): void {
    if (next === mode) return;
    if (next === "raw" && doc) setRaw(buildRaw(mergeFields(doc.data, fields), body));
    setMode(next);
  }

  const readOnly = active?.authority === "db";

  return (
    <div className="panes">
      {/* pane 1 — collections */}
      <section className="pane pane-nav">
        <div className="pane-head">
          <h2 className="pane-title">Collections</h2>
        </div>
        <div className="pane-scroll">
          <Status
            loading={tree.loading && !tree.data}
            error={tree.error}
            empty={!tree.loading && !tree.error && collections.length === 0}
          >
            <p className="muted pane-pad-sm">
              None registered — add one to <code>graft.config.ts</code>.
            </p>
          </Status>
          {collections.map((collection) => (
            <button
              key={collection.name}
              type="button"
              className="row"
              data-active={collection.name === active?.name}
              onClick={() => navigate({ view: "collections", collection: collection.name })}
            >
              <IdentityMark name={collection.name} />
              <span className="row-main">
                <span className="row-title">{collection.name}</span>
                <span className="row-sub">
                  {collection.authority === "db"
                    ? "db-authoritative"
                    : collection.error
                      ? "read failed"
                      : `${collection.documents.length} doc${collection.documents.length === 1 ? "" : "s"}`}
                </span>
              </span>
              {collection.authority === "db" ? (
                <IconDatabase size={13} className="row-mark" />
              ) : collection.driftCount > 0 ? (
                <span className="count" data-tone="drifted" data-numeric="">
                  {collection.driftCount}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </section>

      {/* pane 2 — documents */}
      <section className="pane pane-list">
        <div className="pane-head">
          <div className="pane-head-row">
            <h2 className="pane-title">{active?.name ?? "Documents"}</h2>
            {active?.authority === "db" ? <Pill tone="db">read-only</Pill> : null}
          </div>
          <div className="search">
            <IconSearch size={14} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter documents"
              aria-label="Filter documents"
            />
          </div>
          {active?.authority === "file" ? (
            <div className="segmented" role="group" aria-label="Filter by state">
              {(["all", "drifted", "unindexed"] as Filter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  data-active={filter === f}
                  onClick={() => setFilter(f)}
                >
                  {f === "all" ? "All" : f === "drifted" ? "Out of sync" : "Not indexed"}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="pane-scroll">
          {/* This pane used to swallow errors entirely — a failed tree fetch
              rendered a blank column with no explanation. */}
          <Status loading={tree.loading && !tree.data} error={tree.error ?? active?.error} />

          {active?.authority === "db" ? (
            <div className="pane-pad-sm">
              <EmptyState
                title="Rows, not files"
                body={
                  <>
                    <code>{active.name}</code> is db-authoritative — its records live in{" "}
                    <code>data_records</code> and are reached through typed functions, not MDX on
                    disk.
                  </>
                }
              />
            </div>
          ) : null}

          {active?.authority === "file" && !tree.loading && docs.length === 0 ? (
            <div className="pane-pad-sm">
              <EmptyState
                title={query || filter !== "all" ? "No matches" : "No documents"}
                body={
                  query || filter !== "all" ? (
                    "Nothing in this collection matches the current filter."
                  ) : (
                    <>
                      Author the first one at{" "}
                      <code>content/{active.name}/&lt;slug&gt;.mdx</code>.
                    </>
                  )
                }
              />
            </div>
          ) : null}

          {docs.map((d) => (
            <button
              key={d.slug}
              type="button"
              className="row"
              data-active={route.slug === d.slug}
              onClick={() =>
                navigate({ view: "collections", collection: active?.name, slug: d.slug })
              }
            >
              <StatusDot state={d.state} />
              <span className="row-main">
                <span className="row-title">{d.title ?? d.slug}</span>
                <span className="row-sub">{d.sourcePath}</span>
              </span>
              <span className="row-meta" data-numeric="">
                {d.state === "unindexed" ? STATE_LABEL[d.state] : relativeTime(d.updatedAt)}
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* pane 3 — document */}
      <section className="pane pane-doc">
        {!route.slug ? (
          <div className="pane-pad">
            <EmptyState
              title="No document selected"
              body="Pick one from the list to edit its frontmatter and body."
            />
          </div>
        ) : (
          <>
            <header className="doc-head">
              <div className="doc-head-main">
                <nav className="crumbs" aria-label="Breadcrumb">
                  <span>{active?.name}</span>
                  <span className="crumb-sep">/</span>
                  <span className="crumb-current">{route.slug}</span>
                </nav>
                <h2 className="doc-title">{fields.title || route.slug}</h2>
                <p className="doc-path">
                  <IconFile size={12} />
                  {doc?.sourcePath ?? "…"}
                </p>
              </div>
              <div className="doc-head-actions">
                {selectedState ? <StatePill state={selectedState} /> : null}
                <div className="segmented" role="group" aria-label="Editor mode">
                  <button
                    type="button"
                    data-active={mode === "fields"}
                    onClick={() => switchMode("fields")}
                  >
                    Fields
                  </button>
                  <button
                    type="button"
                    data-active={mode === "raw"}
                    onClick={() => switchMode("raw")}
                  >
                    Raw
                  </button>
                </div>
              </div>
            </header>

            {docError ? (
              <p className="notice" data-tone="error">
                {docError}
              </p>
            ) : null}
            {saveMsg ? (
              <p className="notice" data-tone="ok">
                {saveMsg}
              </p>
            ) : null}

            <div className="doc-scroll">
              {docLoading ? (
                <Status loading />
              ) : mode === "fields" ? (
                <>
                  <div className="field-grid">
                    {Object.keys(fields).length === 0 ? (
                      <p className="muted">No scalar frontmatter — edit the body below.</p>
                    ) : (
                      Object.entries(fields).map(([key, value]) => (
                        <label key={key} className="field">
                          <span className="field-label">{key}</span>
                          {key === "description" || value.length > 80 ? (
                            <textarea
                              rows={3}
                              value={value}
                              disabled={readOnly}
                              onChange={(e) => {
                                setDirty(true);
                                setFields((p) => ({ ...p, [key]: e.target.value }));
                              }}
                            />
                          ) : (
                            <input
                              value={value}
                              disabled={readOnly}
                              onChange={(e) => {
                                setDirty(true);
                                setFields((p) => ({ ...p, [key]: e.target.value }));
                              }}
                            />
                          )}
                        </label>
                      ))
                    )}
                  </div>
                  <label className="field field-body">
                    <span className="field-label">Body</span>
                    <textarea
                      className="code"
                      value={body}
                      spellCheck={false}
                      disabled={readOnly}
                      onChange={(e) => {
                        setDirty(true);
                        setBody(e.target.value);
                      }}
                    />
                  </label>
                </>
              ) : (
                <label className="field field-body">
                  <span className="field-label">MDX source</span>
                  <textarea
                    className="code"
                    value={raw}
                    spellCheck={false}
                    disabled={readOnly}
                    onChange={(e) => {
                      setDirty(true);
                      setRaw(e.target.value);
                    }}
                  />
                </label>
              )}
            </div>

            {/* Pinned like Sanity's Publish — the primary action never scrolls away. */}
            <footer className="doc-foot">
              <span className="doc-foot-hint">
                {readOnly
                  ? "Read-only — db-authoritative collection"
                  : dirty
                    ? "Unsaved changes"
                    : "Saving writes the file and recompiles the index"}
              </span>
              <Button
                variant="primary"
                disabled={saving || !doc || readOnly}
                onClick={() => void save()}
              >
                {saving ? "Saving…" : "Save"}
              </Button>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
