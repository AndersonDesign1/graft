import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type {
  ContentTree,
  ContentTreeCollection,
  DocumentDto,
  DocumentState,
  SchemaList,
} from "../../types";
import { MdxEditor } from "../components/editor";
import { RichEditor } from "../components/rich-editor";
import { FrontmatterForm } from "../components/frontmatter-form";
import { IconDatabase, IconFile, IconWarning } from "../components/icons";
import { DocumentSkeleton } from "../components/skeletons";
import { EmptyState, Pill, StatePill, Status } from "../components/primitives";
import { Tabs, TabsIndicator, TabsList, TabsTrigger } from "../components/ui/tabs";
import { api, qs } from "../lib/api";
import { useAutosave } from "../lib/autosave";
import { hasUnsavedChanges } from "../lib/draft";
import { compareRoundTrip, describeFidelity, type FidelityResult } from "../lib/fidelity";
import type { Route } from "../lib/route";
import { buildForm, composeData } from "../lib/schema-form";
import { useResource } from "../lib/use-resource";

type EditorMode = "rich" | "raw";

/*
 * `buildRaw` used to live here: it rebuilt the whole file from a JS object when
 * the operator switched to Raw MDX. It handled string, number and boolean, and
 * silently skipped everything else — so switching tabs on a document with an
 * `image` asset or a `faqs` array dropped those keys from the buffer, and the
 * next keystroke autosaved the result. On `examples/landing-page/content/pages/
 * home.mdx` that is 589 bytes of authored frontmatter gone.
 *
 * It is deleted rather than fixed. `composeDocument` in @usegraft/compiler is
 * already the single write path and already preserves frontmatter bytes
 * verbatim; a second serialiser in the browser could only ever be a worse copy
 * of it. Switching tabs now flushes and re-reads, so Raw MDX always shows the
 * bytes that are actually on disk.
 */

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
  // Edited frontmatter, keyed by field. `unknown` because an asset field holds
  // an object — the old `string | number | boolean` is exactly the assumption
  // that made assets and arrays invisible.
  const [fields, setFields] = useState<Record<string, unknown>>({});
  const [body, setBody] = useState("");
  const [raw, setRaw] = useState("");
  const [mode, setMode] = useState<EditorMode>("rich");
  const [docError, setDocError] = useState<string | null>(null);
  const [docLoading, setDocLoading] = useState(false);

  const collections = tree.data?.collections ?? [];
  const active: ContentTreeCollection | undefined =
    collections.find((c) => c.name === route.collection) ?? collections[0];
  const readOnly = active?.authority === "db";

  // The declared shape of the active collection. Fetched once for the session:
  // a schema change means editing graft/ and restarting the server anyway.
  const schema = useResource<SchemaList>("/collections");
  const schemaFields = schema.data?.collections.find((c) => c.name === active?.name)?.fields;

  // Whether rich editing is safe is measured, not guessed: the editor
  // re-serialises the document on mount and we compare that against the bytes
  // we loaded. Until the probe reports, rich is allowed — the edit-intent and
  // draft guards already make an unprobed document read-only in practice,
  // since neither an untouched editor nor an unchanged body can write.
  const [fidelity, setFidelity] = useState<FidelityResult | null>(null);
  const effectiveMode: EditorMode = fidelity && !fidelity.lossless ? "raw" : mode;

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
  const latest = useRef({ fields, body, raw, mode: effectiveMode, doc, schemaFields });
  latest.current = { fields, body, raw, mode: effectiveMode, doc, schemaFields };

  const persist = useCallback(async () => {
    const { collection, slug } = route;
    const snapshot = latest.current;
    if (!collection || !slug || !snapshot.doc || readOnly) return;

    // Compose once: the same object is both what the guard compares and what
    // gets written, so they can never disagree about what a save would do.
    const data = composeData(
      snapshot.doc.data,
      snapshot.fields,
      buildForm(snapshot.schemaFields, snapshot.doc.data),
    );

    // Second guard against writing a file nobody edited — see draft.ts.
    const changed = hasUnsavedChanges({
      mode: snapshot.mode,
      data,
      body: snapshot.body,
      raw: snapshot.raw,
      loaded: snapshot.doc,
    });
    if (!changed) return;

    const payload =
      snapshot.mode === "raw"
        ? { collection, slug, raw: snapshot.raw, branch }
        : { collection, slug, data, body: snapshot.body, branch };
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
    // Fidelity is a property of the document, not of the session — a new file
    // is unmeasured until its own editor instance reports back.
    setFidelity(null);
    try {
      const next = await api<DocumentDto>(`/document${qs({ collection, slug })}`);
      setDoc(next);
      setRaw(next.raw);
      setBody(next.body);
      // Seeded from the file, not from the schema: a field the document does
      // not have starts absent, so merely opening a document can never add a
      // key to it. `composeData` enforces the same rule on the way out.
      setFields({ ...next.data });
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

  /**
   * Switch editors by going through the file.
   *
   * Flush whatever is pending, then re-read the document, so each tab opens on
   * the bytes that are actually on disk. The alternative — translating one
   * buffer into the other in the browser — is what `buildRaw` did, and a
   * client-side serialiser can only ever be a lossier copy of the
   * `composeDocument` the server already runs. Going through the file also
   * means the Raw tab is honest: what it shows is what is in git.
   */
  async function switchMode(next: EditorMode): Promise<void> {
    if (next === mode) return;
    try {
      await autosave.flush();
    } catch {
      // The flush already surfaced its own error toast. Staying put is the
      // right failure: switching would show a buffer that disagrees with disk.
      return;
    }
    if (route.collection && route.slug) await openDoc(route.collection, route.slug);
    setMode(next);
  }

  const setField = (key: string, value: unknown): void => {
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
          <Tabs value={effectiveMode} onValueChange={(v) => void switchMode(v as EditorMode)}>
            <TabsList>
              <TabsIndicator />
              {/* Never disabled up front. A document is only refused rich
                  editing once its own editor has proved it would be rewritten,
                  and then the tab explains itself rather than sitting dead. */}
              <TabsTrigger
                value="rich"
                disabled={Boolean(fidelity && !fidelity.lossless)}
                title={fidelity && !fidelity.lossless ? describeFidelity(fidelity) : undefined}
              >
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
            {doc ? (
              <FrontmatterForm
                data={doc.data}
                schemaFields={schemaFields}
                values={fields}
                onChange={setField}
                disabled={readOnly}
                onEditRaw={() => void switchMode("raw")}
              />
            ) : null}

            {fidelity && !fidelity.lossless ? (
              <p className="notice" data-tone="warn">
                <IconWarning size={14} />
                <span>{describeFidelity(fidelity)}</span>
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
                  onFidelity={(roundTripped) => setFidelity(compareRoundTrip(body, roundTripped))}
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
