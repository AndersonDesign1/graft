/**
 * A document's history in the inspector: what was published, by whom and
 * when, newest first. Opening a version shows how the document differs from
 * it now; restoring it saves those bytes as a draft, so going back is an edit
 * like any other and nothing on the site changes until it is published.
 */
import { useEffect, useState } from "react";
import type { VersionDetailDto, VersionDto, VersionListDto } from "../../editor-types";
import type { SchemaFieldDto } from "../../types";
import { api, plainError, qs } from "../lib/api";
import { absoluteTime, relativeTime } from "../lib/format";
import { useResource } from "../lib/use-resource";
import { ChangesList } from "./diff-view";
import { IconBack, IconWarning } from "./icons";

export function HistoryPanel({
  path,
  version,
  fields,
  canRestore,
  onRestore,
}: {
  path: string;
  /** What the editor holds now: a new one means a save landed, so diffs refresh. */
  version: string | null;
  fields: readonly SchemaFieldDto[];
  canRestore: boolean;
  onRestore: (raw: string, from: VersionDto) => void;
}) {
  const list = useResource<VersionListDto>(`/entry/history${qs({ path })}`);
  const [open, setOpen] = useState<VersionDto | null>(null);

  if (open) {
    return (
      <VersionDetail
        path={path}
        entry={open}
        version={version}
        fields={fields}
        canRestore={canRestore}
        onBack={() => setOpen(null)}
        onRestore={onRestore}
      />
    );
  }
  if (list.error) return <Problem text={list.error} />;
  if (!list.data) return <p className="inspector-empty">Loading the history…</p>;
  if (!list.data.available) {
    return <p className="inspector-empty">{list.data.reason || "There is no history here."}</p>;
  }
  if (list.data.versions.length === 0) {
    return <p className="inspector-empty">Not published yet, so there is no history.</p>;
  }
  return (
    <ol className="versions" aria-label="Published versions, newest first">
      {list.data.versions.map((entry) => (
        <li key={entry.id}>
          <button type="button" className="version" onClick={() => setOpen(entry)}>
            <span className="version-head">
              <span className="version-by">{entry.by ?? "Someone"}</span>
              {entry.byKind === "agent" ? <span className="version-tag">Agent</span> : null}
              <time className="version-when" dateTime={entry.at} title={absoluteTime(entry.at)}>
                {relativeTime(entry.at)}
              </time>
            </span>
            <span className="version-note">
              {entry.deleted ? "Deleted" : (entry.message ?? "Published")}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

function VersionDetail({
  path,
  entry,
  version,
  fields,
  canRestore,
  onBack,
  onRestore,
}: {
  path: string;
  entry: VersionDto;
  version: string | null;
  fields: readonly SchemaFieldDto[];
  canRestore: boolean;
  onBack: () => void;
  onRestore: (raw: string, from: VersionDto) => void;
}) {
  const [detail, setDetail] = useState<VersionDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api<VersionDetailDto>(`/entry/version${qs({ path, id: entry.id })}`)
      .then((value) => !cancelled && setDetail(value))
      .catch((err: unknown) => !cancelled && setError(plainError(err)));
    return () => {
      cancelled = true;
    };
  }, [path, entry.id, version]);

  const same =
    detail !== null &&
    detail.diff.fields.length === 0 &&
    !detail.diff.bodyChanged &&
    detail.diff.file.hunks.length === 0;

  return (
    <div className="version-detail">
      <button type="button" className="link version-back" onClick={onBack}>
        <IconBack size={14} aria-hidden="true" />
        All versions
      </button>
      <p className="version-title">
        {entry.by ?? "Someone"},{" "}
        <time dateTime={entry.at} title={absoluteTime(entry.at)}>
          {relativeTime(entry.at)}
        </time>
      </p>
      {entry.message ? <p className="version-message">{entry.message}</p> : null}
      {error ? <Problem text={error} /> : null}
      {!detail && !error ? <p className="inspector-empty">Comparing…</p> : null}
      {detail ? (
        detail.raw === null ? (
          <p className="inspector-empty">This version deleted the document.</p>
        ) : (
          <>
            <h3 className="version-section">What is different now</h3>
            <ChangesList
              diff={detail.diff}
              fields={fields}
              empty="Nothing: this is what the document holds now."
            />
            <button
              type="button"
              className="btn version-restore"
              data-size="sm"
              disabled={!canRestore || same}
              onClick={() => detail.raw !== null && onRestore(detail.raw, entry)}
            >
              Restore this version
            </button>
          </>
        )
      ) : null}
    </div>
  );
}

function Problem({ text }: { text: string }) {
  return (
    <p className="notice" data-tone="error">
      <IconWarning size={14} />
      <span>{text}</span>
    </p>
  );
}
