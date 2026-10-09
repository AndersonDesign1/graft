/**
 * Editing one entry: a page with its title, its fields and its content.
 *
 * The safety rules the old editor earned stay exactly as they were, now
 * pointed at the store-backed API:
 *
 * - a document that is opened and not edited is never written (edit intent,
 *   then a structural no-op check before any save);
 * - a save's identity comes from the snapshot its bytes were loaded with, so a
 *   pending save can never land on the next document;
 * - the body is only edited rich when the rich editor proves it would not
 *   rewrite it; otherwise it is edited as source, beside the same form.
 *
 * New on top: every save carries the version it was read at, so a change
 * made elsewhere (another tab, another editor, an agent over MCP) is reported
 * instead of overwritten, and validation runs before a save rather than after.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { EntryDto, EntryStatus, PublishResultDto, SaveEntryResult } from "../../editor-types";
import type { SchemaFieldDto } from "../../types";
import { FieldRow } from "../components/fields";
import { IconWarning } from "../components/icons";
import { MdxEditor } from "../components/editor";
import { RichEditor } from "../components/rich-editor";
import { DocumentSkeleton } from "../components/skeletons";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "../components/ui/menu";
import { ApiError, api, plainError, qs } from "../lib/api";
import { useAutosave } from "../lib/autosave";
import { problemsFromServer, problemsIn, titleField } from "../lib/fields";
import { compareRoundTrip, describeFidelity, type FidelityResult } from "../lib/fidelity";
import { buildForm, composeData, sameValue } from "../lib/schema-form";
import { collectionLabel, publishVerb, singular, useStudio } from "../lib/studio";
import { StatusLabel } from "./collection";

type Mode = "form" | "source";

export function EntryView({ collection, slug }: { collection: string; slug: string }) {
  const { schema, workspace, drafts, navigate, openPublish } = useStudio();
  const fields = useMemo<SchemaFieldDto[]>(
    () => schema.data?.collections.find((c) => c.name === collection)?.fields ?? [],
    [schema.data, collection],
  );
  const headline = titleField(fields);
  const readOnly = workspace.data ? !workspace.data.canWrite : false;
  const remote = workspace.data?.storage === "github";

  const [entry, setEntry] = useState<EntryDto | null>(null);
  const [edits, setEdits] = useState<Record<string, unknown>>({});
  const [body, setBody] = useState("");
  const [raw, setRaw] = useState("");
  const [mode, setMode] = useState<Mode>("form");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [serverProblems, setServerProblems] = useState<Map<string, string>>(new Map());
  const [conflict, setConflict] = useState(false);
  const [fidelity, setFidelity] = useState<FidelityResult | null>(null);
  const [showAllProblems, setShowAllProblems] = useState(false);

  const form = useMemo(() => buildForm(fields, entry?.data ?? {}), [fields, entry]);
  const data = useMemo(
    () => (entry ? composeData(entry.data, edits, form) : {}),
    [entry, edits, form],
  );
  const localProblems = useMemo(() => problemsIn(fields, data), [fields, data]);
  const problems = useMemo(() => {
    const out = new Map(localProblems);
    for (const [path, message] of serverProblems) out.set(path, message);
    return out;
  }, [localProblems, serverProblems]);

  // Problems are shown for fields someone touched, and for all of them once a
  // save was blocked: a new entry should not open covered in red.
  const touched = useRef(new Set<string>());
  const visibleProblems = useMemo(() => {
    if (showAllProblems) return problems;
    const out = new Map<string, string>();
    for (const [path, message] of problems) {
      if (touched.current.has(path.split(".")[0] ?? path)) out.set(path, message);
    }
    return out;
  }, [problems, showAllProblems]);

  /* ---- loading --------------------------------------------------------- */

  const seq = useRef(0);
  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    setLoadError(null);
    setFidelity(null);
    try {
      const next = await api<EntryDto>(`/entry${qs({ collection, slug })}`);
      if (mine !== seq.current) return;
      setEntry(next);
      setEdits({});
      setBody(next.body);
      setRaw(next.raw);
      setServerProblems(new Map());
      setConflict(false);
      touched.current = new Set();
      setShowAllProblems(false);
    } catch (error) {
      if (mine !== seq.current) return;
      setEntry(null);
      setLoadError(plainError(error));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [collection, slug]);

  /* ---- saving ---------------------------------------------------------- */

  const latest = useRef({ entry, data, body, raw, mode, localProblems, conflict });
  latest.current = { entry, data, body, raw, mode, localProblems, conflict };

  const persist = useCallback(
    async (force = false) => {
      const snap = latest.current;
      if (!snap.entry || readOnly) return;
      if (snap.conflict && !force) return;
      // Identity from the snapshot the bytes came from, never from the route.
      const { collection: name, slug: id, version } = snap.entry;

      const changed =
        snap.mode === "source"
          ? snap.raw !== snap.entry.raw
          : snap.body !== snap.entry.body || !sameValue(snap.data, snap.entry.data);
      if (!changed) return;
      if (snap.mode === "form" && snap.localProblems.size > 0) {
        setShowAllProblems(true);
        throw new Error(
          `Fix ${snap.localProblems.size === 1 ? "1 field" : `${snap.localProblems.size} fields`} to save`,
        );
      }

      try {
        const result = await api<SaveEntryResult>("/entry", {
          method: "PUT",
          body: JSON.stringify({
            collection: name,
            slug: id,
            ...(snap.mode === "source" ? { raw: snap.raw } : { data: snap.data, body: snap.body }),
            ...(force ? {} : { baseVersion: version }),
          }),
        });
        setServerProblems(new Map());
        setConflict(false);
        // What was just written becomes what later saves compare against.
        setEntry((prev) =>
          prev && prev.collection === name && prev.slug === id
            ? {
                ...prev,
                ...(snap.mode === "source"
                  ? { raw: snap.raw }
                  : { data: snap.data, body: snap.body }),
                version: result.version,
                status: result.status,
              }
            : prev,
        );
        if (snap.mode === "form") setEdits({});
        drafts.refresh();
      } catch (error) {
        if (error instanceof ApiError && error.code === "CONTENT_CONFLICT") {
          setConflict(true);
          throw new Error("Changed elsewhere");
        }
        if (error instanceof ApiError && Array.isArray(error.details?.issues)) {
          setShowAllProblems(true);
          setServerProblems(
            problemsFromServer(
              fields,
              snap.data,
              error.details.issues as { path?: (string | number)[]; message?: string }[],
            ),
          );
        }
        throw new Error(plainError(error));
      }
    },
    [readOnly, drafts, fields],
  );

  const autosave = useAutosave({
    save: () => persist(false),
    enabled: !readOnly,
    delay: remote ? 2000 : 900,
  });

  // Flush the old entry before opening the next, so a pending edit never
  // lands on the wrong file.
  const previous = useRef<string | null>(null);
  useEffect(() => {
    const key = `${collection}/${slug}`;
    if (previous.current && previous.current !== key) void autosave.flush().catch(() => {});
    previous.current = key;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection, slug, load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void autosave.flush().catch(() => {});
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [autosave]);

  const setField = (key: string, value: unknown): void => {
    touched.current.add(key);
    setEdits((prev) => ({ ...prev, [key]: value }));
    autosave.touch();
  };

  /* ---- actions --------------------------------------------------------- */

  async function switchMode(next: Mode): Promise<void> {
    if (next === mode) return;
    try {
      await autosave.flush();
    } catch {
      return; // the flush said why; staying put keeps the buffer honest
    }
    await load();
    setMode(next);
  }

  async function publishThis(): Promise<void> {
    if (!entry) return;
    try {
      await autosave.flush();
      const result = await api<PublishResultDto>("/drafts/publish", {
        method: "POST",
        body: JSON.stringify({ paths: [entry.path] }),
      });
      toast.success(
        result.action === "review"
          ? "Submitted for review"
          : result.action === "commit"
            ? "Committed"
            : "Published",
        {
          description:
            result.action === "publish" ? "The site updates when it redeploys." : undefined,
          ...(result.review
            ? {
                action: { label: "View", onClick: () => window.open(result.review?.url, "_blank") },
              }
            : {}),
        },
      );
      drafts.refresh();
      await load();
    } catch (error) {
      if (error instanceof ApiError && error.code === "CONTENT_CONFLICT") {
        openPublish();
        return;
      }
      toast.error(plainError(error));
    }
  }

  async function discardThis(): Promise<void> {
    if (!entry) return;
    if (
      !window.confirm("Discard your changes to this entry? The published version stays as it is.")
    )
      return;
    try {
      await api("/drafts/discard", {
        method: "POST",
        body: JSON.stringify({ paths: [entry.path] }),
      });
      drafts.refresh();
      if (entry.status === "new") {
        toast.success("Draft discarded");
        navigate({ view: "collection", collection });
      } else {
        toast.success("Back to the published version");
        await load();
      }
    } catch (error) {
      toast.error(plainError(error));
    }
  }

  async function duplicate(): Promise<void> {
    try {
      await autosave.flush();
      const copy = await api<SaveEntryResult>("/entry/duplicate", {
        method: "POST",
        body: JSON.stringify({ collection, slug }),
      });
      drafts.refresh();
      toast.success("Duplicated");
      navigate({ view: "entry", collection, slug: copy.slug });
    } catch (error) {
      toast.error(plainError(error));
    }
  }

  async function remove(): Promise<void> {
    if (!entry) return;
    const name = String(entry.data[headline?.name ?? "title"] ?? slug);
    if (
      !window.confirm(
        `Delete ${name}? ${entry.status === "new" ? "It was never published." : "It stays live until you publish the deletion."}`,
      )
    )
      return;
    const snapshot = entry;
    try {
      await api("/entry", {
        method: "DELETE",
        body: JSON.stringify({ collection, slug, baseVersion: entry.version }),
      });
      drafts.refresh();
      navigate({ view: "collection", collection });
      toast.success(`${name} deleted`, {
        duration: 8000,
        action: {
          label: "Undo",
          onClick: () => {
            // A published entry comes back by discarding the deletion; one
            // that was never published is written again from what we held.
            const undo =
              snapshot.status === "new"
                ? api("/entry", {
                    method: "POST",
                    body: JSON.stringify({
                      collection,
                      slug,
                      data: snapshot.data,
                      body: snapshot.body,
                    }),
                  })
                : api("/drafts/discard", {
                    method: "POST",
                    body: JSON.stringify({ paths: [snapshot.path] }),
                  });
            void undo
              .then(() => {
                drafts.refresh();
                navigate({ view: "entry", collection, slug });
              })
              .catch((error: unknown) => toast.error(plainError(error)));
          },
        },
      });
    } catch (error) {
      toast.error(plainError(error));
    }
  }

  /* ---- render ---------------------------------------------------------- */

  if (loading && !entry) {
    return (
      <div className="entry">
        <div className="page">
          <DocumentSkeleton />
        </div>
      </div>
    );
  }
  if (loadError || !entry) {
    return (
      <div className="entry">
        <div className="page page-empty">
          <p className="page-empty-title">This entry can't be opened.</p>
          <p className="muted">{loadError}</p>
          <button
            type="button"
            className="btn"
            onClick={() => navigate({ view: "collection", collection })}
          >
            Back to {collectionLabel(collection).toLowerCase()}
          </button>
        </div>
      </div>
    );
  }

  // Status follows the drafts list, which every save and publish refreshes,
  // so publishing from the sheet updates this bar without a reload.
  const draft = drafts.data?.changes.find((change) => change.path === entry.path);
  const status: EntryStatus = drafts.data
    ? draft
      ? draft.kind === "added"
        ? "new"
        : draft.kind === "deleted"
          ? "deleted"
          : "changed"
      : "published"
    : entry.status;
  const others = fields.filter((field) => field !== headline);
  const bodyAsSource = fidelity !== null && !fidelity.lossless;
  const action = drafts.data?.publish;
  const saveLabel = saveText(
    autosave.state,
    autosave.error,
    localProblems.size,
    conflict,
    readOnly,
  );

  return (
    <div className="entry">
      <div className="entry-bar">
        <StatusLabel status={status} conflict={draft?.conflict ?? entry.conflict} />
        <span
          className="save"
          data-state={conflict ? "conflict" : autosave.state}
          aria-live="polite"
        >
          {saveLabel}
        </span>
        <span className="entry-bar-spacer" />
        <Menu>
          <MenuTrigger
            className="btn"
            data-variant="ghost"
            data-size="sm"
            aria-label="More actions"
          >
            •••
          </MenuTrigger>
          <MenuContent align="end">
            <MenuItem onClick={() => void switchMode(mode === "form" ? "source" : "form")}>
              {mode === "form" ? "Edit source" : "Edit as form"}
            </MenuItem>
            <MenuItem disabled={readOnly} onClick={() => void duplicate()}>
              Duplicate
            </MenuItem>
            <MenuItem
              onClick={() => {
                void navigator.clipboard?.writeText(window.location.href);
                toast.success("Link copied");
              }}
            >
              Copy link
            </MenuItem>
            {status !== "published" ? (
              <MenuItem disabled={readOnly} onClick={() => void discardThis()}>
                Discard changes
              </MenuItem>
            ) : null}
            <MenuSeparator />
            <MenuItem
              disabled={readOnly}
              className="menu-item-danger"
              onClick={() => void remove()}
            >
              Delete {singular(collection)}
            </MenuItem>
          </MenuContent>
        </Menu>
        <button
          type="button"
          className="btn"
          data-variant="primary"
          data-size="sm"
          disabled={readOnly || status === "published" || autosave.state === "saving"}
          onClick={() => void publishThis()}
          title={status === "published" ? "No unpublished changes" : undefined}
        >
          {action === "review" ? "Submit" : publishVerb(action)}
        </button>
      </div>

      {conflict ? (
        <div className="banner" data-tone="conflict" role="alert">
          <IconWarning size={14} />
          <span>
            This {singular(collection)} was changed somewhere else after you opened it. Your edits
            are still here, not saved.
          </span>
          <button type="button" className="btn" data-size="sm" onClick={() => void load()}>
            Load their version
          </button>
          <button
            type="button"
            className="btn"
            data-size="sm"
            data-variant="primary"
            onClick={() => {
              void persist(true)
                .then(() => toast.success("Saved your version"))
                .catch((error: unknown) => toast.error(plainError(error)));
            }}
          >
            Keep mine
          </button>
        </div>
      ) : null}

      <div className="page-scroll">
        <article className="page" aria-label={`Editing ${collectionLabel(collection)}`}>
          {mode === "source" ? (
            <>
              <p className="page-kicker">Source</p>
              <p className="muted page-note">
                The file exactly as stored, frontmatter included. Saves are checked against the
                schema the same way.
              </p>
              <div className="page-source">
                <MdxEditor
                  value={raw}
                  readOnly={readOnly}
                  showLineNumbers
                  ariaLabel="Entry source"
                  onChange={(next) => {
                    setRaw(next);
                    autosave.touch();
                  }}
                />
              </div>
            </>
          ) : (
            <>
              {headline ? (
                <TitleInput
                  value={String(data[headline.name] ?? "")}
                  placeholder={`Untitled ${singular(collection)}`}
                  readOnly={readOnly}
                  problem={visibleProblems.get(headline.name)}
                  onChange={(next) => setField(headline.name, next)}
                />
              ) : null}
              <p className="page-slug">
                <span className="muted">{collection}/</span>
                {slug}
              </p>

              {others.length > 0 ? (
                <div className="form-grid">
                  {others.map((field) => (
                    <FieldRow
                      key={field.name}
                      field={field}
                      value={data[field.name]}
                      path={field.name}
                      problems={visibleProblems}
                      disabled={readOnly}
                      onChange={(next) => setField(field.name, next)}
                    />
                  ))}
                </div>
              ) : null}

              <section className="page-body" aria-label="Content">
                <div className="page-body-head">
                  <h2 className="page-section">Content</h2>
                  {bodyAsSource ? <span className="page-body-mode">Markdown</span> : null}
                </div>
                {bodyAsSource ? (
                  <p className="notice" data-tone="warn">
                    <IconWarning size={14} />
                    <span>{describeFidelity(fidelity)}</span>
                  </p>
                ) : null}
                {bodyAsSource ? (
                  <MdxEditor
                    value={body}
                    readOnly={readOnly}
                    ariaLabel="Content as markdown"
                    onChange={(next) => {
                      setBody(next);
                      autosave.touch();
                    }}
                  />
                ) : (
                  <RichEditor
                    key={`${collection}/${slug}`}
                    value={entry.body}
                    readOnly={readOnly}
                    onFidelity={(roundTripped) =>
                      setFidelity(compareRoundTrip(entry.body, roundTripped))
                    }
                    onChange={(next) => {
                      setBody(next);
                      autosave.touch();
                    }}
                  />
                )}
              </section>
            </>
          )}
        </article>
      </div>
    </div>
  );
}

function saveText(
  state: string,
  error: string | null,
  problemCount: number,
  conflict: boolean,
  readOnly: boolean,
): string {
  if (readOnly) return "View only";
  if (conflict) return "Not saved";
  if (state === "saving") return "Saving…";
  if (state === "dirty")
    return problemCount > 0
      ? `Fix ${problemCount === 1 ? "1 field" : `${problemCount} fields`} to save`
      : "Unsaved";
  if (state === "error") return error ?? "Not saved";
  if (state === "saved") return "Saved";
  return "Saved";
}

/** The headline, in the face the site publishes with, growing with its text. */
function TitleInput({
  value,
  placeholder,
  readOnly,
  problem,
  onChange,
}: {
  value: string;
  placeholder: string;
  readOnly: boolean;
  problem: string | undefined;
  onChange: (next: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <div className="page-title-wrap" data-invalid={problem ? "" : undefined}>
      <textarea
        ref={ref}
        className="page-title"
        rows={1}
        value={value}
        placeholder={placeholder}
        readOnly={readOnly}
        aria-label="Title"
        aria-invalid={problem ? true : undefined}
        onChange={(e) => onChange(e.target.value.replace(/\n/g, " "))}
      />
      {problem ? (
        <p className="fr-problem" role="alert">
          <IconWarning size={13} />
          <span>{problem}</span>
        </p>
      ) : null}
    </div>
  );
}
