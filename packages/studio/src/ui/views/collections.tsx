import { useCallback, useEffect, useState } from "react";
import type {
  ContentTree,
  ContentTreeCollection,
  DocumentDto,
  DocumentState,
} from "../../types";
import { MdxEditor } from "../components/editor";
import { IconDatabase, IconFile } from "../components/icons";
import { EmptyState, Pill, StatePill, Status } from "../components/primitives";
import { Button } from "../components/ui/button";
import { Field, FieldLabel, Input, NumberField, Switch, Textarea } from "../components/ui/field";
import { Tabs, TabsIndicator, TabsList, TabsTrigger } from "../components/ui/tabs";
import { api, qs } from "../lib/api";
import type { Route } from "../lib/route";

type EditorMode = "fields" | "raw";

/**
 * Frontmatter values the field editor can round-trip. Anything else (arrays,
 * nested objects) is left to the Raw tab rather than flattened into a string
 * the user would have to retype correctly.
 */
type Scalar = {
  key: string;
  value: string | number | boolean;
  kind: "string" | "number" | "boolean";
};

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

  /* The list pane is gone — the sidebar tree is the document list now, so
     this view is only ever the document itself. */

  if (tree.error) {
    return (
      <div className="pane-pad">
        <Status error={tree.error} />
      </div>
    );
  }

  if (readOnly && !route.slug) {
    return (
      <div className="pane-pad">
        <EmptyState
          title="Rows, not files"
          icon={<IconDatabase size={20} />}
          body={
            <>
              <code>{active?.name}</code> is db-authoritative — its records live in{" "}
              <code>data_records</code> and are reached through typed functions, not MDX on disk.
            </>
          }
        />
      </div>
    );
  }

  if (!route.slug) {
    return (
      <div className="pane-pad">
        <EmptyState
          title="No document selected"
          icon={<IconFile size={20} />}
          body="Pick one from the content tree to edit its frontmatter and body."
        />
      </div>
    );
  }

  return (
    <section className="pane pane-doc">
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
          {readOnly ? <Pill tone="db">read-only</Pill> : null}
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
              <p className="doc-fields-label">Frontmatter</p>
              {Object.keys(fields).length === 0 ? (
                <p className="muted">No scalar frontmatter — edit the body alongside.</p>
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
        <Button variant="primary" disabled={saving || !doc || readOnly} onClick={() => void save()}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </footer>
    </section>
  );
}
