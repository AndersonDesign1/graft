import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type {
  ContentTree,
  ContentTreeCollection,
  DocumentDto,
  DocumentState,
} from "../../types";
import { MdxEditor } from "../components/editor";
import { hasMdxSyntax, RichEditor } from "../components/rich-editor";
import { IconDatabase, IconFile, IconWarning } from "../components/icons";
import { DocumentSkeleton } from "../components/skeletons";
import { EmptyState, Pill, StatePill, Status } from "../components/primitives";
import { Field, FieldLabel, Input, NumberField, Switch, Textarea } from "../components/ui/field";
import { Tabs, TabsIndicator, TabsList, TabsTrigger } from "../components/ui/tabs";
import { api, qs } from "../lib/api";
import { useAutosave } from "../lib/autosave";
import { hasUnsavedChanges } from "../lib/draft";
import type { Route } from "../lib/route";

type EditorMode = "rich" | "raw";

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

const SAVE_LABEL: Record<string, string> = {
  idle: "Saved",
  dirty: "Editing…",
  saving: "Saving…",
  saved: "Saved",
  error: "Not saved",
};

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
  const [mode, setMode] = useState<EditorMode>("rich");
  const [docError, setDocError] = useState<string | null>(null);
  const [docLoading, setDocLoading] = useState(false);

  const collections = tree.data?.collections ?? [];
  const active: ContentTreeCollection | undefined =
    collections.find((c) => c.name === route.collection) ?? collections[0];
  const readOnly = active?.authority === "db";

  // MDX is markdown plus JSX, and a commonmark editor has no node for
  // `<Callout>`. Rather than quietly mangle it on the next save, those
  // documents stay in Raw.
  const mdxOnly = useMemo(() => hasMdxSyntax(body), [body]);
  const effectiveMode: EditorMode = mdxOnly ? "raw" : mode;

  useEffect(() => {
    if (!route.collection && active) {
      navigate({
        view: "collections",
        collection: active.name,
        slug: active.authority === "db" ? undefined : active.documents[0]?.slug,
      });
    }
  }, [active, route.collection, navigate]);

  // Latest values, so the debounced save never writes a stale snapshot.
  const latest = useRef({ fields, body, raw, mode: effectiveMode, doc });
  latest.current = { fields, body, raw, mode: effectiveMode, doc };

  const persist = useCallback(async () => {
    const { collection, slug } = route;
    const snapshot = latest.current;
    if (!collection || !slug || !snapshot.doc || readOnly) return;

    // Second guard against writing a file nobody edited — see draft.ts.
    const changed = hasUnsavedChanges({
      mode: snapshot.mode,
      fields: snapshot.fields,
      body: snapshot.body,
      raw: snapshot.raw,
      loaded: snapshot.doc,
    });
    if (!changed) return;

    const payload =
      snapshot.mode === "raw"
        ? { collection, slug, raw: snapshot.raw, branch }
        : {
            collection,
            slug,
            data: { ...snapshot.doc.data, ...snapshot.fields },
            body: snapshot.body,
            branch,
          };
    await api<{ written: string; gitSha: string | null }>("/document", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    // Toasted here rather than off the autosave state, so it fires exactly
    // when a file was written — the guard above means "saved" can mean
    // "decided not to write", and a toast claiming otherwise would be a lie.
    // The fixed id replaces the previous toast instead of stacking one per
    // pause in typing.
    toast.success("Saved", {
      id: "document-autosave",
      description: `${collection}/${slug}`,
      duration: 1600,
    });
    onSaved();
  }, [route.collection, route.slug, branch, readOnly, onSaved]);

  const autosave = useAutosave({ save: persist, enabled: !readOnly });

  // Surface failures as a toast — a save that silently didn't happen is the
  // one thing an autosaving editor must never do.
  useEffect(() => {
    if (autosave.state === "error" && autosave.error) {
      toast.error("Could not save", { description: autosave.error });
    }
  }, [autosave.state, autosave.error]);

  const openDoc = useCallback(async (collection: string, slug: string) => {
    setDocError(null);
    setDocLoading(true);
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

  // Flush before swapping documents, or the pending edit lands on the wrong file.
  const previous = useRef<string | null>(null);
  useEffect(() => {
    const key = route.collection && route.slug ? `${route.collection}/${route.slug}` : null;
    if (previous.current && previous.current !== key) void autosave.flush();
    previous.current = key;
    if (route.collection && route.slug) void openDoc(route.collection, route.slug);
    else setDoc(null);
    // autosave.flush is stable; including it would re-open on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.collection, route.slug, openDoc]);

  const selectedState: DocumentState | undefined = active?.documents.find(
    (d) => d.slug === route.slug,
  )?.state;

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void autosave.flush();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [autosave]);

  function switchMode(next: EditorMode): void {
    if (next === mode) return;
    if (next === "raw" && doc) setRaw(buildRaw({ ...doc.data, ...fields }, body));
    if (next === "rich" && doc) {
      // Raw is authoritative while it is open, so re-split it on the way back.
      const match = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
      setBody(match ? raw.slice(match[0].length) : raw);
    }
    setMode(next);
  }

  const setField = (key: string, value: string | number | boolean): void => {
    setFields((prev) => ({ ...prev, [key]: value }));
    autosave.touch();
  };

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
          <p className="doc-path">
            <IconFile size={12} />
            {doc?.sourcePath ?? "…"}
          </p>
        </div>
        <div className="doc-head-actions">
          <span className="save-state" data-state={autosave.state}>
            {readOnly ? "Read-only" : SAVE_LABEL[autosave.state]}
          </span>
          {readOnly ? <Pill tone="db">db</Pill> : null}
          {selectedState ? <StatePill state={selectedState} /> : null}
          <Tabs value={effectiveMode} onValueChange={(v) => switchMode(v as EditorMode)}>
            <TabsList>
              <TabsIndicator />
              <TabsTrigger value="rich" disabled={mdxOnly}>
                Rich
              </TabsTrigger>
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

      {/* One column. Frontmatter is part of the document, not a sidebar to it,
          so it sits above the body in the same scroll. */}
      <div className="doc-scroll">
        {docLoading ? (
          <DocumentSkeleton />
        ) : (
          <article className="doc-sheet">
            <div className="doc-frontmatter">
              {doc &&
                scalars(doc.data).map((field) => (
                  <Field key={field.key} disabled={readOnly} className="doc-field">
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
                        rows={2}
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
                ))}
              {doc && scalars(doc.data).length === 0 ? (
                <p className="muted">No frontmatter fields.</p>
              ) : null}
            </div>

            {mdxOnly ? (
              <p className="notice" data-tone="warn">
                <IconWarning size={14} />
                <span>
                  This document uses MDX components, which the rich editor cannot represent without
                  rewriting them. Editing the source directly keeps them intact.
                </span>
              </p>
            ) : null}

            <div className="doc-body-editor">
              {effectiveMode === "rich" ? (
                <RichEditor
                  // Remount per document: the editor owns its buffer, so a new
                  // file needs a new instance rather than a contents swap.
                  key={`${route.collection}/${route.slug}`}
                  value={body}
                  readOnly={readOnly}
                  onChange={(next) => {
                    setBody(next);
                    autosave.touch();
                  }}
                />
              ) : (
                <MdxEditor
                  value={raw}
                  readOnly={readOnly}
                  showLineNumbers
                  ariaLabel="Raw MDX source"
                  onChange={(next) => {
                    setRaw(next);
                    autosave.touch();
                  }}
                />
              )}
            </div>
          </article>
        )}
      </div>
    </section>
  );
}
