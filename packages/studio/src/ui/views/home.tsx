/**
 * Where an editor lands: what there is to edit, and what is waiting.
 *
 * Laid out like the front of a printed paper, because that is the house
 * style (black, ivory, one red) and because it answers the two questions in
 * order: what is new (the lede), and where things are (the contents). The
 * index-health dashboard this replaces is one click away, under Developer.
 */
import { useEffect, useState } from "react";
import type { EntryList } from "../../editor-types";
import { api, qs } from "../lib/api";
import {
  collectionLabel,
  editableCollections,
  publishVerb,
  singular,
  useStudio,
} from "../lib/studio";

function greeting(now: Date): string {
  const hour = now.getHours();
  if (hour < 5) return "Working late";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

const KIND: Record<string, string> = { added: "New", modified: "Edited", deleted: "Deleted" };

export function HomeView() {
  const { schema, workspace, drafts, navigate, openPublish, openCreate } = useStudio();
  const collections = editableCollections(schema.data);
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    for (const collection of collections) {
      api<EntryList>(`/entries${qs({ collection: collection.name, limit: 1 })}`)
        .then(
          (list) =>
            !cancelled && setCounts((prev) => ({ ...prev, [collection.name]: list.counts.all })),
        )
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema.data]);

  const now = new Date();
  const user = workspace.data?.user;
  const firstName = (user?.name ?? "").split(" ")[0];
  const changes = drafts.data?.changes ?? [];
  const reviews = drafts.data?.reviews ?? [];
  const canWrite = workspace.data?.canWrite ?? true;

  return (
    <div className="home">
      <header className="masthead">
        <p className="masthead-dateline">
          <time dateTime={now.toISOString().slice(0, 10)}>
            {now.toLocaleDateString(undefined, {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </time>
          {workspace.data?.repository ? <span> · {workspace.data.repository}</span> : null}
        </p>
        <h1 className="masthead-title">
          {greeting(now)}
          {firstName ? `, ${firstName}` : ""}.
        </h1>
        <p className="masthead-lede">
          {drafts.loading && !drafts.data ? (
            " "
          ) : drafts.error && !drafts.data ? (
            `Unpublished changes can't be loaded right now: ${drafts.error}`
          ) : changes.length === 0 ? (
            "Everything is published."
          ) : (
            <>
              <span className="masthead-count" data-numeric="">
                {changes.length}
              </span>{" "}
              {changes.length === 1 ? "change is" : "changes are"} waiting to be{" "}
              {drafts.data?.publish === "review"
                ? "submitted"
                : drafts.data?.publish === "commit"
                  ? "committed"
                  : "published"}
              .{" "}
              <button type="button" className="link" onClick={openPublish}>
                Review and {publishVerb(drafts.data?.publish).toLowerCase()}
              </button>
            </>
          )}
        </p>
      </header>

      <div className="home-columns">
        <section className="contents" aria-labelledby="contents-title">
          <h2 className="section-label" id="contents-title">
            Contents
          </h2>
          <ol className="toc">
            {collections.map((collection, i) => (
              <li key={collection.name} className="toc-row">
                <a className="toc-link" href={`#/c/${encodeURIComponent(collection.name)}`}>
                  <span className="toc-num" data-numeric="">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="toc-name">{collectionLabel(collection.name)}</span>
                  <span className="toc-leader" aria-hidden="true" />
                  <span className="toc-count" data-numeric="">
                    {counts[collection.name] ?? "·"}
                  </span>
                </a>
                {canWrite ? (
                  <button
                    type="button"
                    className="toc-new"
                    onClick={() => openCreate(collection.name)}
                    aria-label={`New ${singular(collection.name)}`}
                  >
                    New
                  </button>
                ) : null}
                {collection.description ? (
                  <p className="toc-desc">{collection.description}</p>
                ) : null}
              </li>
            ))}
          </ol>
        </section>

        <aside className="desk" aria-label="Your work">
          <section>
            <h2 className="section-label">
              {drafts.data?.publish === "commit"
                ? "Not committed yet"
                : drafts.data?.publish === "review"
                  ? "Waiting to submit"
                  : "Waiting to publish"}
            </h2>
            {changes.length === 0 ? (
              <p className="desk-empty">Nothing yet. Edits are saved as drafts and appear here.</p>
            ) : (
              <ul className="desk-list">
                {changes.slice(0, 8).map((change) => (
                  <li key={change.path}>
                    <button
                      type="button"
                      className="desk-item"
                      disabled={change.kind === "deleted"}
                      onClick={() =>
                        navigate({
                          view: "entry",
                          collection: change.collection,
                          slug: change.slug,
                        })
                      }
                    >
                      <span className="desk-title">{change.title}</span>
                      <span className="desk-meta">
                        {collectionLabel(change.collection)} · {KIND[change.kind]}
                        {change.conflict ? " · needs a decision" : ""}
                      </span>
                    </button>
                  </li>
                ))}
                {changes.length > 8 ? (
                  <li>
                    <button type="button" className="link" onClick={openPublish}>
                      and {changes.length - 8} more
                    </button>
                  </li>
                ) : null}
              </ul>
            )}
          </section>
          {reviews.length > 0 ? (
            <section>
              <h2 className="section-label">In review</h2>
              <ul className="desk-list">
                {reviews.map((review) => (
                  <li key={review.number}>
                    <a className="desk-item" href={review.url} target="_blank" rel="noreferrer">
                      <span className="desk-title">{review.title}</span>
                      <span className="desk-meta">Pull request #{review.number}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
