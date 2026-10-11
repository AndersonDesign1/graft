/**
 * Where an editor lands. It answers, in order, the two questions an editor
 * opens Studio with: what is waiting for me, and where is everything.
 *
 * "Waiting for you" comes first because it is the only part that changes
 * between visits: drafts to commit or publish, an agent waiting on an
 * approval, a pull request in review. When nothing waits, it says so in one
 * line. The index-health dashboard is one click away, under Developer.
 */
import { useEffect, useState } from "react";
import type { EntryList } from "../../editor-types";
import { CollectionMark } from "../components/collection-icon";
import { IconCheck, IconCommit, IconExternal, IconPlus, IconWaiting } from "../components/icons";
import { api, qs } from "../lib/api";
import { plural } from "../lib/format";
import {
  collectionLabel,
  editableCollections,
  publishVerb,
  singular,
  useStudio,
} from "../lib/studio";
import { useResource } from "../lib/use-resource";

export function HomeView() {
  const { schema, workspace, drafts, navigate, openPublish, openCreate } = useStudio();
  const collections = editableCollections(schema.data);
  const [counts, setCounts] = useState<Record<string, number>>({});
  // Approvals live in Postgres; a workspace without them answers with an
  // error, which here just means there is nothing to show.
  const approvals = useResource<{ approvals: unknown[] }>("/approvals");

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

  const changes = drafts.data?.changes ?? [];
  const reviews = drafts.data?.reviews ?? [];
  const pending = approvals.data?.approvals.length ?? 0;
  const canWrite = workspace.data?.canWrite ?? true;
  const action = drafts.data?.publish;
  const verb = publishVerb(action);
  const done = action === "commit" ? "committed" : "published";
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const title = workspace.data?.repository?.split("/")[1] ?? "Content";

  return (
    <div className="home">
      <header className="view-head">
        <h1 className="view-title">{title}</h1>
        <p className="view-sub">
          {!schema.data
            ? "\u00a0"
            : collections.length === 0
              ? "No collections stored as MDX files yet. Add one to graft.config.ts."
              : `${plural(total, "entry", "entries")} in ${plural(collections.length, "collection")}`}
        </p>
      </header>

      <section className="home-section" aria-labelledby="waiting-title">
        <h2 className="section-title" id="waiting-title">
          Waiting for you
        </h2>
        <ul className="waiting">
          {drafts.error && !drafts.data ? (
            <li>
              <span className="waiting-main">
                <span className="waiting-title">Drafts can't be loaded right now</span>
                <span className="waiting-sub">{drafts.error}</span>
              </span>
            </li>
          ) : changes.length > 0 ? (
            <li>
              <IconCommit className="waiting-icon" aria-hidden="true" />
              <span className="waiting-main">
                <span className="waiting-title">
                  {plural(changes.length, "draft")} not {done} yet
                </span>
                <span className="waiting-sub">
                  {changes
                    .slice(0, 3)
                    .map((change) => change.title)
                    .join(", ")}
                  {changes.length > 3 ? `, and ${changes.length - 3} more` : ""}
                </span>
              </span>
              <button type="button" className="btn" data-size="sm" onClick={openPublish}>
                Review and {verb.toLowerCase()}
              </button>
            </li>
          ) : null}
          {pending > 0 ? (
            <li>
              <IconWaiting className="waiting-icon" data-tone="waiting" aria-hidden="true" />
              <span className="waiting-main">
                <span className="waiting-title">
                  {pending === 1
                    ? "An agent is waiting on your approval"
                    : `${pending} agent requests are waiting on your approval`}
                </span>
                <span className="waiting-sub">Nothing destructive happens until you decide.</span>
              </span>
              <a className="btn" data-size="sm" href="#/dev/approvals">
                Review
              </a>
            </li>
          ) : null}
          {reviews.map((review) => (
            <li key={review.number}>
              <IconExternal className="waiting-icon" aria-hidden="true" />
              <span className="waiting-main">
                <span className="waiting-title">{review.title}</span>
                <span className="waiting-sub">In review as pull request #{review.number}</span>
              </span>
              <a className="btn" data-size="sm" href={review.url} target="_blank" rel="noreferrer">
                Open
              </a>
            </li>
          ))}
          {drafts.data &&
          !approvals.loading &&
          changes.length === 0 &&
          pending === 0 &&
          reviews.length === 0 ? (
            <li>
              <IconCheck className="waiting-icon" aria-hidden="true" />
              <span className="waiting-main">
                <span className="waiting-title">Nothing is waiting</span>
                <span className="waiting-sub">
                  Everything is {done}. Edits are saved as drafts and show up here.
                </span>
              </span>
            </li>
          ) : null}
        </ul>
      </section>

      <section className="home-section" aria-labelledby="collections-title">
        <h2 className="section-title" id="collections-title">
          Collections
        </h2>
        <table className="list">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col" data-align="end">
                Entries
              </th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {collections.map((collection) => (
              <tr
                key={collection.name}
                className="list-row"
                onClick={() => navigate({ view: "collection", collection: collection.name })}
              >
                <td>
                  <a
                    className="list-name"
                    href={`#/c/${encodeURIComponent(collection.name)}`}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <CollectionMark name={collection.name} authority="file" />
                    {collectionLabel(collection.name)}
                  </a>
                  {collection.description ? (
                    <span className="list-desc">{collection.description}</span>
                  ) : null}
                </td>
                <td data-align="end" data-numeric="">
                  {counts[collection.name] ?? ""}
                </td>
                <td data-align="end">
                  {canWrite ? (
                    <button
                      type="button"
                      className="btn"
                      data-variant="ghost"
                      data-size="sm"
                      onClick={(event) => {
                        event.stopPropagation();
                        openCreate(collection.name);
                      }}
                      aria-label={`New ${singular(collection.name)}`}
                    >
                      <IconPlus size={14} aria-hidden="true" />
                      New
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
