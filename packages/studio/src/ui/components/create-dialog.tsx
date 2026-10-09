/**
 * A new entry, asking only for what it cannot exist without.
 *
 * Every save is validated (the same rule MCP's write_content follows, and the
 * one that keeps a local index compilable), so an entry is created valid: the
 * dialog shows the required fields, and everything optional waits for the
 * full editor. The URL name follows the title until someone changes it.
 */
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { SaveEntryResult } from "../../editor-types";
import { slugify } from "../../slug";
import { ApiError, api, plainError } from "../lib/api";
import { emptyValue, labelOf, problemsFromServer, problemsIn, titleField } from "../lib/fields";
import { singular, useStudio } from "../lib/studio";
import { FieldRow } from "./fields";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";

export function CreateDialog({
  collection,
  onOpenChange,
  onCreated,
}: {
  collection: string | null;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const { schema, navigate } = useStudio();
  const fields = useMemo(
    () => schema.data?.collections.find((c) => c.name === collection)?.fields ?? [],
    [schema.data, collection],
  );
  const required = fields.filter((field) => !field.optional);
  const headline = titleField(fields);
  const [data, setData] = useState<Record<string, unknown>>({});
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [showProblems, setShowProblems] = useState(false);
  const [serverProblems, setServerProblems] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (collection) {
      // A required choice starts on its first option and a required switch
      // starts off, so the form opens with nothing to correct but the blanks.
      const start: Record<string, unknown> = {};
      for (const field of required) {
        if (field.type === "select" || field.type === "boolean")
          start[field.name] = emptyValue(field);
      }
      setData(start);
      setSlug("");
      setSlugTouched(false);
      setShowProblems(false);
      setServerProblems(new Map());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection, fields]);

  const problems = useMemo(() => {
    const local = problemsIn(required, data);
    for (const [path, message] of serverProblems) local.set(path, message);
    return local;
  }, [required, data, serverProblems]);
  const title = headline ? String(data[headline.name] ?? "") : "";
  const effectiveSlug = slugTouched ? slug : slugify(title);
  const noun = collection ? singular(collection) : "entry";

  async function create(): Promise<void> {
    if (!collection) return;
    setShowProblems(true);
    if (problemsIn(required, data).size > 0) return;
    setBusy(true);
    try {
      const result = await api<SaveEntryResult>("/entry", {
        method: "POST",
        body: JSON.stringify({
          collection,
          data,
          ...(slugify(effectiveSlug) ? { slug: slugify(effectiveSlug) } : {}),
        }),
      });
      toast.success(`${title || "New " + noun} created`, { description: "Saved as a draft." });
      onCreated();
      onOpenChange(false);
      navigate({ view: "entry", collection, slug: result.slug });
    } catch (error) {
      if (error instanceof ApiError && Array.isArray(error.details?.issues)) {
        setServerProblems(
          problemsFromServer(
            fields,
            data,
            error.details.issues as { path?: (string | number)[]; message?: string }[],
          ),
        );
      } else {
        toast.error(plainError(error));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={collection !== null} onOpenChange={onOpenChange}>
      <DialogContent className="dialog create">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <DialogTitle className="create-title">New {noun}</DialogTitle>
          <DialogDescription className="create-lede">
            {required.length > 1
              ? "Fill in what it needs to exist. Everything else can wait for the editor."
              : "Give it a name. Everything else can wait for the editor."}
          </DialogDescription>
          <div className="create-fields">
            {required.map((field, i) => (
              <FieldRow
                key={field.name}
                field={field}
                value={data[field.name]}
                path={field.name}
                problems={showProblems ? problems : new Map()}
                autoFocus={i === 0}
                onChange={(next) => {
                  setServerProblems(new Map());
                  setData((prev) => {
                    const out = { ...prev, [field.name]: next };
                    if (next === "" || next === undefined) delete out[field.name];
                    return out;
                  });
                }}
              />
            ))}
            <div className="fr" data-wide="">
              <div className="fr-head">
                <label className="fr-label" htmlFor="create-slug">
                  URL name
                </label>
              </div>
              <input
                id="create-slug"
                className="input create-slug"
                value={effectiveSlug}
                placeholder={headline ? `from the ${labelOf(headline).toLowerCase()}` : "my-entry"}
                spellCheck={false}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"));
                }}
              />
              <p className="fr-help">
                Part of the page's address. It can't be changed later without breaking links.
              </p>
            </div>
          </div>
          <footer className="create-foot">
            <button
              type="button"
              className="btn"
              data-variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </button>
            <button type="submit" className="btn" data-variant="primary" disabled={busy}>
              {busy ? "Creating…" : `Create ${noun}`}
            </button>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}
