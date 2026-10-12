/**
 * Publishing, in the editor's words.
 *
 * Lists the person's unpublished changes as entries ("Wool Hat · Edited"),
 * lets them look at what changed and choose what goes, and says plainly what
 * pressing the button will do: publish to the site, submit for review, or
 * commit on this computer. Git is underneath all three; none of its words are
 * needed to use it.
 */
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { DraftChangeDto, DraftsDto, PublishResultDto, WorkspaceDto } from "../../editor-types";
import { ApiError, api, plainError } from "../lib/api";
import { actionWord, collectionLabel, doneWord, publishVerb, useStudio } from "../lib/studio";
import { DiffView } from "./diff-view";
import { IconCaretDown, IconCheck, IconExternal, IconWarning } from "./icons";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { useConfirm } from "./ui/confirm";

const KIND_LABEL: Record<DraftChangeDto["kind"], string> = {
  added: "New",
  modified: "Edited",
  deleted: "Deleted",
};

/** One sentence: what happens when the button is pressed. */
function consequence(action: DraftsDto["publish"], workspace: WorkspaceDto | null): string {
  const where = workspace?.repository ? ` on ${workspace.repository}` : "";
  const database = workspace?.storage === "database";
  if (action === "review") {
    return database
      ? "Asks someone who can publish to review them. Nothing goes live until they approve."
      : `Opens a pull request${where} for someone to review. Nothing goes live until it is merged.`;
  }
  if (database) return "Puts these changes on the live site straight away.";
  if (action === "commit") {
    return "Records these changes in git on this computer. Nothing is pushed; push when you are ready to deploy.";
  }
  return `Commits to ${workspace?.branch ?? "the live branch"}${where}. The site updates when it redeploys, usually within a couple of minutes.`;
}

export function PublishSheet({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const { drafts, workspace, schema, navigate } = useStudio();
  const confirm = useConfirm();
  const changes = drafts.data?.changes ?? [];
  const action = drafts.data?.publish ?? "publish";
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<"publish" | "discard" | null>(null);
  const [resolve, setResolve] = useState<Record<string, "mine" | "theirs">>({});
  const [done, setDone] = useState<PublishResultDto | null>(null);

  // Everything is selected by default, and newly arriving drafts join the
  // selection: "publish all" is the common case.
  useEffect(() => {
    if (open) {
      drafts.refresh();
      setDone(null);
      setResolve({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const paths = useMemo(() => changes.map((change) => change.path), [changes]);
  useEffect(() => setSelected(new Set(paths)), [paths]);

  const chosen = changes.filter((change) => selected.has(change.path));
  const unresolved = chosen.filter((change) => change.conflict && !resolve[change.path]);

  async function publish(): Promise<void> {
    setBusy("publish");
    try {
      const result = await api<PublishResultDto>("/drafts/publish", {
        method: "POST",
        body: JSON.stringify({
          paths: chosen.map((change) => change.path),
          message,
          resolve,
        }),
      });
      setDone(result);
      setMessage("");
      onDone();
    } catch (error) {
      if (error instanceof ApiError && error.code === "CONTENT_CONFLICT") drafts.refresh();
      toast.error(plainError(error));
    } finally {
      setBusy(null);
    }
  }

  async function discard(): Promise<void> {
    const names = chosen.map((change) => change.title).join(", ");
    const ok = await confirm({
      kind: "discard",
      title: `Discard your changes to ${names}?`,
      body: `Your edits are thrown away. The ${doneWord(action)} versions stay as they are.`,
      action: chosen.length === 1 ? "Discard changes" : `Discard ${chosen.length} changes`,
    });
    if (!ok) return;
    setBusy("discard");
    try {
      await api("/drafts/discard", {
        method: "POST",
        body: JSON.stringify({ paths: chosen.map((change) => change.path) }),
      });
      toast.success(
        chosen.length === 1 ? "Changes discarded" : `${chosen.length} changes discarded`,
      );
      onDone();
    } catch (error) {
      toast.error(plainError(error));
    } finally {
      setBusy(null);
    }
  }

  const verb = publishVerb(action);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sheet" aria-describedby="publish-consequence">
        <header className="sheet-head">
          <DialogTitle className="sheet-title">
            {action === "review"
              ? "Submit for review"
              : action === "commit"
                ? "Commit changes"
                : "Publish changes"}
          </DialogTitle>
        </header>

        {done ? (
          <Done result={done} onClose={() => onOpenChange(false)} />
        ) : changes.length === 0 ? (
          <div className="sheet-empty">
            {(drafts.data?.reviews ?? []).length > 0 ? (
              <>
                <p className="sheet-empty-title">
                  Nothing new to {action === "review" ? "submit" : action}.
                </p>
                <p className="sheet-empty-body">
                  These are waiting for someone to review and merge them.
                </p>
                <Reviews reviews={drafts.data?.reviews ?? []} />
              </>
            ) : (
              <>
                <p className="sheet-empty-title">Everything is {doneWord(action)}.</p>
                <p className="sheet-empty-body">
                  Edits you make are saved as drafts and gather here until you {actionWord(action)}{" "}
                  them.
                </p>
              </>
            )}
          </div>
        ) : (
          <>
            <DialogDescription id="publish-consequence" className="sheet-lede">
              {consequence(action, workspace.data)}
            </DialogDescription>

            <div className="sheet-select">
              <label className="check">
                <input
                  type="checkbox"
                  checked={chosen.length === changes.length}
                  ref={(el) => {
                    if (el) el.indeterminate = chosen.length > 0 && chosen.length < changes.length;
                  }}
                  onChange={(e) => setSelected(e.target.checked ? new Set(paths) : new Set())}
                />
                <span>
                  {chosen.length} of {changes.length} selected
                </span>
              </label>
            </div>

            <ul className="sheet-list">
              {changes.map((change) => (
                <li
                  key={change.path}
                  className="sheet-item"
                  data-expanded={expanded === change.path || undefined}
                >
                  <div className="sheet-row">
                    <input
                      type="checkbox"
                      checked={selected.has(change.path)}
                      aria-label={`Include ${change.title}`}
                      onChange={() =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (next.has(change.path)) next.delete(change.path);
                          else next.add(change.path);
                          return next;
                        })
                      }
                    />
                    <button
                      type="button"
                      className="sheet-row-main"
                      aria-expanded={expanded === change.path}
                      onClick={() =>
                        setExpanded((prev) => (prev === change.path ? null : change.path))
                      }
                    >
                      <span className="sheet-row-title">{change.title}</span>
                      <span className="sheet-row-meta">
                        {collectionLabel(change.collection)} ·{" "}
                        <span data-kind={change.kind}>{KIND_LABEL[change.kind]}</span>
                      </span>
                      <IconCaretDown size={14} className="sheet-row-caret" />
                    </button>
                    {change.kind !== "deleted" ? (
                      <button
                        type="button"
                        className="link"
                        onClick={() => {
                          onOpenChange(false);
                          navigate({
                            view: "entry",
                            collection: change.collection,
                            slug: change.slug,
                          });
                        }}
                      >
                        Open
                      </button>
                    ) : null}
                  </div>
                  {change.conflict ? (
                    <div
                      className="sheet-conflict"
                      role="group"
                      aria-label={`Resolve ${change.title}`}
                    >
                      <p>
                        <IconWarning size={14} />
                        Someone published a newer version of this since you started editing.
                      </p>
                      <div className="sheet-conflict-choices">
                        <label>
                          <input
                            type="radio"
                            name={`resolve-${change.path}`}
                            checked={resolve[change.path] === "mine"}
                            onChange={() =>
                              setResolve((prev) => ({ ...prev, [change.path]: "mine" }))
                            }
                          />
                          Publish mine over it
                        </label>
                        <label>
                          <input
                            type="radio"
                            name={`resolve-${change.path}`}
                            checked={resolve[change.path] === "theirs"}
                            onChange={() =>
                              setResolve((prev) => ({ ...prev, [change.path]: "theirs" }))
                            }
                          />
                          Keep theirs, discard mine
                        </label>
                      </div>
                    </div>
                  ) : null}
                  {expanded === change.path ? (
                    <DiffView
                      path={change.path}
                      fields={
                        schema.data?.collections.find((c) => c.name === change.collection)
                          ?.fields ?? []
                      }
                    />
                  ) : null}
                </li>
              ))}
            </ul>

            {(drafts.data?.reviews ?? []).length > 0 ? (
              <Reviews reviews={drafts.data?.reviews ?? []} />
            ) : null}

            <footer className="sheet-foot">
              <label className="sheet-message">
                <span className="fr-label">Describe the change</span>
                <span className="fr-optional">Optional</span>
                <input
                  className="input"
                  value={message}
                  placeholder={
                    chosen.length === 1
                      ? `Update ${chosen[0]?.title}`
                      : `Update ${chosen.length} entries`
                  }
                  onChange={(e) => setMessage(e.target.value)}
                />
              </label>
              <div className="sheet-actions">
                <button
                  type="button"
                  className="btn"
                  data-variant="ghost"
                  disabled={chosen.length === 0 || busy !== null}
                  onClick={() => void discard()}
                >
                  {busy === "discard" ? "Discarding…" : "Discard"}
                </button>
                <button
                  type="button"
                  className="btn"
                  data-variant="primary"
                  disabled={chosen.length === 0 || unresolved.length > 0 || busy !== null}
                  title={
                    unresolved.length > 0
                      ? "Choose what to do with the changes marked above"
                      : undefined
                  }
                  onClick={() => void publish()}
                >
                  {busy === "publish"
                    ? action === "review"
                      ? "Submitting…"
                      : action === "commit"
                        ? "Committing…"
                        : "Publishing…"
                    : `${verb}${chosen.length > 1 ? ` ${chosen.length}` : ""}`}
                </button>
              </div>
            </footer>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Reviews({ reviews }: { reviews: DraftsDto["reviews"] }) {
  return (
    <section className="sheet-reviews">
      <h3 className="sheet-subtitle">In review</h3>
      <ul>
        {reviews.map((review) => (
          <li key={review.id}>
            {review.url ? (
              <a href={review.url} target="_blank" rel="noreferrer" className="link">
                {review.title}
                <IconExternal size={14} />
              </a>
            ) : (
              review.title
            )}
            {review.number !== undefined ? <span className="muted"> #{review.number}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The result, in words: what went where, and what to do next. A success is
 * bright, not an animation.
 */
function Done({ result, onClose }: { result: PublishResultDto; onClose: () => void }) {
  const count = result.published.length;
  const what = count === 1 ? "1 change" : `${count} changes`;
  const kept = result.tookTheirs.length;
  // Every conflict resolved as "keep theirs": nothing went out, and saying
  // "Published 0 changes" would read as a failure.
  const onlyKept = count === 0 && kept > 0;
  // Someone else published or discarded every one of them first.
  const nothing = count === 0 && kept === 0;
  return (
    <div className="sheet-done">
      <IconCheck className="sheet-done-mark" size={20} aria-hidden="true" />
      <p className="sheet-done-title">
        {nothing
          ? "Nothing left to publish."
          : onlyKept
            ? `Kept the published ${kept === 1 ? "version" : "versions"}.`
            : result.action === "review"
              ? `Submitted ${what} for review.`
              : result.action === "commit"
                ? `Committed ${what}.`
                : `Published ${what}.`}
      </p>
      <p className="sheet-done-body">
        {nothing
          ? "These changes were already published or discarded by someone else."
          : onlyKept
            ? `Your ${kept === 1 ? "draft was" : "drafts were"} discarded; nothing else changed.`
            : result.action === "review"
              ? result.review?.url
                ? "They go live when the pull request is merged."
                : "They go live when someone who can publish approves them."
              : result.action === "commit"
                ? `Commit ${result.commit?.shortSha ?? ""} is on this computer. Push it to deploy.`
                : result.live
                  ? "They're live on the site now."
                  : "The site updates as soon as it redeploys."}
      </p>
      <div className="sheet-done-actions">
        {result.review?.url ? (
          <a className="btn" href={result.review.url} target="_blank" rel="noreferrer">
            View pull request
          </a>
        ) : result.commit?.url ? (
          <a className="btn" href={result.commit.url} target="_blank" rel="noreferrer">
            View on GitHub
          </a>
        ) : null}
        <button type="button" className="btn" data-variant="primary" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
