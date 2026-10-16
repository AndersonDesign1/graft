/**
 * One field set to one value on the entries selected in a list.
 *
 * The field and its value use the same controls as the entry editor, and the
 * server checks each entry as a save would, so a value that would be refused
 * in the editor is refused here too. Every entry becomes a draft; nothing goes
 * live until it is published. Entries that could not be saved stay listed in
 * the dialog with the reason, next to the action that caused it.
 */
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { EntrySummary, SetFieldResultDto } from "../../editor-types";
import type { SchemaFieldDto } from "../../types";
import { api, plainError } from "../lib/api";
import { emptyValue, isBlank, labelOf, problemsIn, settableFields } from "../lib/fields";
import { actionWord, singular, useStudio } from "../lib/studio";
import { FieldRow } from "./fields";
import { IconWarning } from "./icons";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";

export function SetFieldDialog({
  collection,
  entries,
  fields,
  open,
  onOpenChange,
  onSaved,
}: {
  collection: string;
  entries: EntrySummary[];
  fields: readonly SchemaFieldDto[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** After a request that saved anything; `failed` are the slugs still to fix. */
  onSaved: (failed: string[]) => void;
}) {
  const { drafts } = useStudio();
  const settable = useMemo(() => settableFields(fields), [fields]);
  const [name, setName] = useState<string>("");
  const [value, setValue] = useState<unknown>(undefined);
  const [showProblems, setShowProblems] = useState(false);
  const [failed, setFailed] = useState<SetFieldResultDto["failed"]>([]);
  const [busy, setBusy] = useState(false);
  const field = settable.find((candidate) => candidate.name === name);

  const pick = (next: SchemaFieldDto | undefined): void => {
    setName(next?.name ?? "");
    // A switch has no empty state, so it starts off; an optional choice or
    // text starts empty, which removes it unless a value is given.
    setValue(next && (!next.optional || next.type === "boolean") ? emptyValue(next) : undefined);
    setShowProblems(false);
  };

  useEffect(() => {
    if (!open) return;
    pick(settable[0]);
    setFailed([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, settable]);

  // The field chooser is a select field of its own, so it looks and works
  // like every other choice in Studio.
  const chooser: SchemaFieldDto = {
    name: "field",
    type: "select",
    label: "Field",
    optional: false,
    options: settable.map((candidate) => ({ value: candidate.name, label: labelOf(candidate) })),
  };
  const problems = useMemo(
    () => (field ? problemsIn([field], { [field.name]: value }) : new Map<string, string>()),
    [field, value],
  );
  const titles = new Map(entries.map((entry) => [entry.slug, entry.title]));
  const count = entries.length;
  const noun = count === 1 ? singular(collection) : collection;
  const removing =
    field?.optional === true && field.type !== "boolean" && isBlank(value, field.type);
  const label = field ? labelOf(field) : "";

  async function submit(): Promise<void> {
    if (!field) return;
    setShowProblems(true);
    if (problems.size > 0) return;
    setBusy(true);
    try {
      const result = await api<SetFieldResultDto>("/entries/field", {
        method: "POST",
        body: JSON.stringify({
          collection,
          slugs: entries.map((entry) => entry.slug),
          field: field.name,
          value: removing ? null : value,
        }),
      });
      const saved = result.saved.length;
      if (saved > 0) {
        toast.success(
          `${removing ? "Removed" : "Set"} ${label} on ${saved} ${saved === 1 ? singular(collection) : collection}`,
          { description: saved === 1 ? "Saved as a draft." : "Saved as drafts." },
        );
        onSaved(result.failed.map((entry) => entry.slug));
      }
      setFailed(result.failed);
      if (result.failed.length === 0) onOpenChange(false);
    } catch (error) {
      // The request may have stopped partway, after some entries were saved.
      // Show the list as it is now, with the selection kept to try again.
      toast.error(plainError(error), {
        description: "Some entries may have been saved. The list shows which.",
      });
      drafts.refresh();
      onSaved(entries.map((entry) => entry.slug));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="create">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <DialogTitle className="create-title">
            Set a field on {count} {noun}
          </DialogTitle>
          <DialogDescription className="create-lede">
            Each one is saved as a draft. Nothing changes on the site until you{" "}
            {actionWord(drafts.data?.publish)} them.
          </DialogDescription>
          <div className="create-fields">
            <FieldRow
              field={chooser}
              value={name}
              path="__field"
              problems={new Map()}
              onChange={(next) => pick(settable.find((candidate) => candidate.name === next))}
            />
            {field ? (
              <FieldRow
                key={field.name}
                field={
                  field.optional && field.type !== "boolean"
                    ? {
                        ...field,
                        description: [field.description, "Leave it empty to remove it."]
                          .filter(Boolean)
                          .join(" "),
                      }
                    : field
                }
                value={value}
                path={field.name}
                problems={showProblems ? problems : new Map()}
                onChange={setValue}
              />
            ) : null}
          </div>
          {failed.length > 0 ? (
            <div className="set-field-failed" role="alert">
              <p className="set-field-failed-title">
                <IconWarning size={14} aria-hidden="true" />
                {failed.length === 1
                  ? "1 entry wasn't saved"
                  : `${failed.length} entries weren't saved`}
              </p>
              <ul>
                {failed.map((entry) => (
                  <li key={entry.slug}>
                    <b>{titles.get(entry.slug) ?? entry.slug}</b>: {entry.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <footer className="create-foot">
            <button
              type="button"
              className="btn"
              data-variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              {failed.length > 0 ? "Close" : "Cancel"}
            </button>
            <button type="submit" className="btn" data-variant="primary" disabled={busy || !field}>
              {busy
                ? "Saving…"
                : `${removing ? "Remove" : "Set"} ${label || "field"} on ${count} ${noun}`}
            </button>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}
