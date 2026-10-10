/**
 * What changed in a draft, said the way an editor would say it: "Price,
 * $139.00 → $145.50", "Content edited". The file's line diff is one click
 * further, for anyone who wants the exact bytes. Fetched on demand: a publish
 * sheet with forty changes should not download forty diffs nobody opened.
 */
import { useEffect, useState } from "react";
import type { DraftDiffDto } from "../../editor-types";
import type { SchemaFieldDto } from "../../types";
import { api, plainError, qs } from "../lib/api";
import { humanise, labelOf } from "../lib/fields";
import { formatCell } from "./fields";
import { IconWarning } from "./icons";

function describe(field: SchemaFieldDto | undefined, value: unknown): string {
  if (value === null || value === undefined || value === "") return "empty";
  if (Array.isArray(value)) return value.length === 1 ? "1 item" : `${value.length} items`;
  if (typeof value === "object") {
    const key = (value as { key?: unknown }).key;
    return typeof key === "string" ? key : "a group of values";
  }
  const text = formatCell(field, value);
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
}

/** Schema order, so the list reads like the form; unknown keys last. */
function order(fields: readonly SchemaFieldDto[], name: string): number {
  const i = fields.findIndex((field) => field.name === name);
  return i === -1 ? fields.length : i;
}

export function DiffView({
  path,
  fields = [],
}: {
  path: string;
  fields?: readonly SchemaFieldDto[];
}) {
  const [diff, setDiff] = useState<DraftDiffDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showFile, setShowFile] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<DraftDiffDto>(`/drafts/diff${qs({ path })}`)
      .then((value) => !cancelled && setDiff(value))
      .catch((err: unknown) => !cancelled && setError(plainError(err)));
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (error) {
    return (
      <p className="notice" data-tone="error">
        <IconWarning size={14} />
        <span>{error}</span>
      </p>
    );
  }
  if (!diff) return <p className="diff-note">Comparing with the published version…</p>;

  const file = diff.file;
  return (
    <div className="changes">
      {diff.fields.length > 0 || diff.bodyChanged ? (
        <dl className="changes-fields">
          {[...diff.fields]
            .sort((a, b) => order(fields, a.field) - order(fields, b.field))
            .map((change) => {
              const field = fields.find((candidate) => candidate.name === change.field);
              const before = describe(field, change.before);
              const after = describe(field, change.after);
              return (
                <div key={change.field} className="changes-row">
                  <dt>{field ? labelOf(field) : humanise(change.field)}</dt>
                  <dd>
                    {before === after ? (
                      "edited"
                    ) : change.before === null ? (
                      <span className="changes-after">{after}</span>
                    ) : (
                      <>
                        <span className="changes-before">{before}</span>
                        <span className="changes-arrow" aria-label="changed to">
                          →
                        </span>
                        <span className="changes-after">{after}</span>
                      </>
                    )}
                  </dd>
                </div>
              );
            })}
          {diff.bodyChanged ? (
            <div className="changes-row">
              <dt>Content</dt>
              <dd>edited</dd>
            </div>
          ) : null}
        </dl>
      ) : (
        <p className="diff-note">No visible changes.</p>
      )}

      {file.hunks.length > 0 ? (
        <button
          type="button"
          className="link changes-toggle"
          onClick={() => setShowFile((v) => !v)}
        >
          {showFile ? "Hide the file changes" : "Show the file changes"}
        </button>
      ) : null}
      {showFile ? (
        <div className="diff">
          {file.hunks.map((hunk, i) => (
            <div key={i} className="diff-hunk">
              {hunk.lines.map((line, j) => (
                <div key={j} className="diff-line" data-kind={line.kind}>
                  <span className="diff-gutter" data-numeric="">
                    {line.oldLine ?? ""}
                  </span>
                  <span className="diff-gutter" data-numeric="">
                    {line.newLine ?? ""}
                  </span>
                  <span className="diff-mark" aria-hidden="true">
                    {line.kind === "add" ? "+" : line.kind === "remove" ? "−" : " "}
                  </span>
                  {/* Whitespace is content in markdown: shown exactly as it is. */}
                  <code className="diff-text">{line.text || " "}</code>
                </div>
              ))}
            </div>
          ))}
          {file.truncated ? (
            <p className="diff-note">Showing the first 600 changed lines.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
