import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ContentTree,
  ContentTreeCollection,
  ContentTreeDoc,
  DocumentDto,
  DocumentState,
} from "../../types";
import { MdxEditor } from "../components/editor";
import { IconDatabase, IconFile, IconSearch, IconSort } from "../components/icons";
import {
  EmptyState,
  Pill,
  StatePill,
  StatusDot,
  Status,
  STATE_LABEL,
} from "../components/primitives";
import { Button } from "../components/ui/button";
import { Field, FieldLabel, Input, NumberField, Switch, Textarea } from "../components/ui/field";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from "../components/ui/menu";
import { Tabs, TabsIndicator, TabsList, TabsTrigger } from "../components/ui/tabs";
import { api, qs } from "../lib/api";
import { relativeTime } from "../lib/format";
import type { Route } from "../lib/route";

type EditorMode = "fields" | "raw";
type Filter = "all" | "drifted" | "unindexed";
type SortMode = "site" | "alpha" | "updated";

const SORTS: Array<{ id: SortMode; label: string; hint: string }> = [
  { id: "site", label: "Site order", hint: "Section, then order — as published" },
  { id: "alpha", label: "A–Z", hint: "By title" },
  { id: "updated", label: "Recently indexed", hint: "Newest compile first" },
];

/**
 * Frontmatter values the field editor can round-trip. Anything else (arrays,
 * nested objects) is left to the Raw tab rather than flattened into a string
 * the user would have to retype correctly.
 */
type Scalar = { key: string; value: string | number | boolean; kind: "string" | "number" | "boolean" };

function scalars(data: Record<string, unknown>): Scalar[] {
  const out: Scalar[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string") out.push({ key, value, kind: "string" });
    else if (typeof value === "number") out.push({ key, value, kind: "number" });
    else if (typeof value === "boolean") out.push({ key, value, kind: "boolean" });
  }
  const order = ["title", "description", "section", "order", "tagline"];
  out.sort((a, b) => {
    const ai = order.indexOf(a.key);
    const bi = order.indexOf(b.key);
    if (ai === -1 && bi === -1) return a.key.localeCompare(b.key);
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

/** Documents in the order the site renders them, grouped by section. */
function group(docs: ContentTreeDoc[], sort: SortMode): Array<[string, ContentTreeDoc[]]> {
  const sorted = [...docs];
  if (sort === "alpha") {
    sorted.sort((a, b) => (a.title ?? a.slug).localeCompare(b.title ?? b.slug));
  } else if (sort === "updated") {
    sorted.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  }
  // "site" arrives pre-sorted from the API, which owns the ordering rule.

  if (sort !== "site" || !sorted.some((d) => d.section)) return [["", sorted]];

  const sections = new Map<string, ContentTreeDoc[]>();
  for (const doc of sorted) {
    const key = doc.section ?? "Ungrouped";
    const list = sections.get(key);
    if (list) list.push(doc);
    else sections.set(key, [doc]);
  }
  return [...sections.entries()];
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
  const [sort, setSort] = useState<SortMode>("site");
  const [doc, setDoc] = useState<DocumentDto | null>(null);
  const [fields, setFields] = useState<Record<string, string | number | boolean>>({});
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

  useEffect(() => {
    if (!route.collection && active) {
      navigate({ view: "collections", collection: active.name });
    }
  }, [active, route.collection, navigate]);

  const visible = useMemo(() => {
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

  const groups = useMemo(() => group(visible, sort), [visible, sort]);

  const openDoc = useCallback(async (collection: string, slug: string) => {
    setDocError(null);
    setSaveMsg(null);
    setDocLoading(true);
    setDirty(false);
    try {
      const next = await api<DocumentDto>(`/document${qs({ collection, slug })}`);
      setDoc(next);
      setRaw(next.raw);
      setBody(next.body);
      setFields(Object.fromEntries(scalars(next.data).map((f) => [f.key, f.value])));
    } catch (err) {
      setDoc(null);
      setRaw("");
      setBody("");
      setFields({});
      setDocError(err instanceof Error ? err.message : String(err));
    } finally {
      setDocLoading(false);
    }
  }, []);

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
              data: { ...doc.data, ...fields },
              body,
              branch,
            };
      const result = await api<{ written: string; gitSha: string | null }>("/document", {
        method: "PUT",
        body: JSON.stringify(payload),
      });
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
    if (next === "raw" && doc) setRaw(buildRaw({ ...doc.data, ...fields }, body));
    setMode(next);
  }

  const setField = (key: string, value: string | number | boolean): void => {
    setDirty(true);
    setFields((prev) => ({ ...prev, [key]: value }));
  };

  const readOnly = active?.authority === "db";

  return (
    <div className="panes">
      {/* pane 1 — documents (collections now live in the rail) */}
      <section className="pane pane-list">
        <div className="pane-head">
          <div className="pane-head-row">
            <h2 className="pane-title">{active?.name ?? "Documents"}</h2>
            {active?.authority === "db" ? (
              <Pill tone="db">
                <IconDatabase size={11} />
                read-only
              </Pill>
            ) : (
              <Menu>
                <MenuTrigger className="icon-btn" aria-label="Sort documents" title="Sort">
                  <IconSort size={14} />
                </MenuTrigger>
                <MenuContent align="end">
                  <MenuLabel>Order</MenuLabel>
                  {SORTS.map((option) => (
                    <MenuItem
                      key={option.id}
                      data-active={sort === option.id}
                      onClick={() => setSort(option.id)}
                    >
                      <span className="menu-item-label">{option.label}</span>
                      <span className="menu-item-hint">{option.hint}</span>
                    </MenuItem>
                  ))}
                </MenuContent>
              </Menu>
            )}
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
            <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
              <TabsList>
                <TabsIndicator />
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="drifted">Out of sync</TabsTrigger>
                <TabsTrigger value="unindexed">New</TabsTrigger>
              </TabsList>
            </Tabs>
          ) : null}
        </div>

        <div className="pane-scroll">
          <Status loading={tree.loading && !tree.data} error={tree.error ?? active?.error} />

          {active?.authority === "db" ? (
            <div className="pane-pad-sm">
              <EmptyState
                title="Rows, not files"
                icon={<IconDatabase size={20} />}
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

          {active?.authority === "file" && !tree.loading && visible.length === 0 ? (
            <div className="pane-pad-sm">
              <EmptyState
                title={query || filter !== "all" ? "No matches" : "No documents"}
                body={
                  query || filter !== "all" ? (
                    "Nothing in this collection matches the current filter."
                  ) : (
                    <>
                      Author the first one at <code>content/{active.name}/&lt;slug&gt;.mdx</code>.
                    </>
                  )
                }
              />
            </div>
          ) : null}

          {groups.map(([section, docs]) => (
            <div key={section || "_"} className="doc-group">
              {section ? <p className="doc-group-label">{section}</p> : null}
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
          ))}
        </div>
      </section>

      {/* pane 2 — the document */}
      <section className="pane pane-doc">
        {!route.slug ? (
          <div className="pane-pad">
            <EmptyState
              title="No document selected"
              icon={<IconFile size={20} />}
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
                <h2 className="doc-title">{String(fields.title ?? route.slug)}</h2>
                <p className="doc-path">
                  <IconFile size={12} />
                  {doc?.sourcePath ?? "…"}
                </p>
              </div>
              <div className="doc-head-actions">
                {selectedState ? <StatePill state={selectedState} /> : null}
                <Tabs value={mode} onValueChange={(v) => switchMode(v as EditorMode)}>
                  <TabsList>
                    <TabsIndicator />
                    <TabsTrigger value="fields">Fields</TabsTrigger>
                    <TabsTrigger value="raw">Raw MDX</TabsTrigger>
                  </TabsList>
                </Tabs>
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

            <div className="doc-body" data-mode={mode}>
              {docLoading ? (
                <div className="doc-scroll">
                  <Status loading />
                </div>
              ) : mode === "fields" ? (
                <>
                  <div className="doc-fields">
                    {Object.keys(fields).length === 0 ? (
                      <p className="muted">No scalar frontmatter — edit the body below.</p>
                    ) : (
                      doc &&
                      scalars(doc.data).map((field) => (
                        <Field key={field.key} disabled={readOnly}>
                          <FieldLabel>{field.key}</FieldLabel>
                          {field.kind === "boolean" ? (
                            <Switch
                              checked={Boolean(fields[field.key])}
                              onCheckedChange={(next) => setField(field.key, next)}
                              disabled={readOnly}
                            />
                          ) : field.kind === "number" ? (
                            <NumberField
                              value={Number(fields[field.key] ?? 0)}
                              onValueChange={(next) => setField(field.key, next ?? 0)}
                              disabled={readOnly}
                            />
                          ) : String(fields[field.key] ?? "").length > 72 ||
                            field.key === "description" ? (
                            <Textarea
                              rows={3}
                              value={String(fields[field.key] ?? "")}
                              disabled={readOnly}
                              onChange={(e) => setField(field.key, e.target.value)}
                            />
                          ) : (
                            <Input
                              value={String(fields[field.key] ?? "")}
                              disabled={readOnly}
                              onChange={(e) => setField(field.key, e.target.value)}
                            />
                          )}
                        </Field>
                      ))
                    )}
                  </div>
                  <div className="doc-editor">
                    <p className="doc-editor-label">Body</p>
                    <MdxEditor
                      value={body}
                      onChange={(next) => {
                        setDirty(true);
                        setBody(next);
                      }}
                      readOnly={readOnly}
                      ariaLabel="Document body"
                      placeholder="Write MDX…"
                    />
                  </div>
                </>
              ) : (
                <div className="doc-editor doc-editor-full">
                  <MdxEditor
                    value={raw}
                    onChange={(next) => {
                      setDirty(true);
                      setRaw(next);
                    }}
                    readOnly={readOnly}
                    showLineNumbers
                    ariaLabel="Raw MDX source"
                  />
                </div>
              )}
            </div>

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
