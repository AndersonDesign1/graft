/**
 * Everything waiting on a person's decision, in one place: changes sent for
 * review by someone who may not publish, and agents asking before a
 * destructive call. Both used to live apart (reviews on Home, approvals under
 * Developer); a decision is a decision, wherever it came from.
 */
import { useState } from "react";
import { toast } from "sonner";
import type { DraftChangeDto, PublishResultDto, ReviewRequest } from "../../editor-types";
import type { ApprovalList, PendingApprovalDto } from "../../types";
import { IconCheck, IconExternal, IconWaiting } from "../components/icons";
import { useConfirm } from "../components/ui/confirm";
import { api, plainError } from "../lib/api";
import { describeRequest, inputSummary } from "../lib/approvals";
import { absoluteTime, plural, relativeTime } from "../lib/format";
import { useStudio } from "../lib/studio";
import { useResource } from "../lib/use-resource";

export function InboxView({ onDecided }: { onDecided?: () => void }) {
  const { drafts } = useStudio();
  // Approvals live in Postgres; a workspace without them answers with an
  // error, which here only means there are none to show.
  const approvals = useResource<ApprovalList>("/approvals");
  const reviews = drafts.data?.reviews ?? [];
  const requests = approvals.data?.approvals ?? [];
  const loading = (!drafts.data && !drafts.error) || (approvals.loading && !approvals.data);
  const total = reviews.length + requests.length;

  return (
    <div className="view inbox">
      <header className="view-head">
        <div>
          <h1 className="view-title">Inbox</h1>
          <p className="view-sub">
            {loading
              ? " "
              : total === 0
                ? "Nothing is waiting on a decision."
                : `${plural(total, "thing")} waiting on a decision.`}
          </p>
        </div>
      </header>

      {!loading && total === 0 ? (
        <p className="inbox-empty">
          <IconCheck aria-hidden="true" />
          <span>
            Changes sent for review, and agents asking before they delete or overwrite anything,
            show up here.
          </span>
        </p>
      ) : null}

      {reviews.length > 0 ? (
        <section className="inbox-section" aria-labelledby="inbox-reviews">
          <h2 className="section-title" id="inbox-reviews">
            Changes for review
          </h2>
          <ul className="inbox-list">
            {reviews.map((review) => (
              <ReviewRow
                key={review.id}
                review={review}
                changes={drafts.data?.changes ?? []}
                canPublish={drafts.data?.publish === "publish"}
                onPublished={() => drafts.refresh()}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {requests.length > 0 ? (
        <section className="inbox-section" aria-labelledby="inbox-agents">
          <h2 className="section-title" id="inbox-agents">
            Agents asking first
          </h2>
          <ul className="inbox-list">
            {requests.map((request) => (
              <ApprovalRow
                key={request.id}
                request={request}
                onDecided={() => {
                  approvals.refresh();
                  onDecided?.();
                }}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/**
 * Agents' requests alone, for a host embedding the queue
 * (`ApprovalQueuePanel`), where there is no Studio around it.
 */
export function ApprovalQueue({ onDecided }: { onDecided?: () => void }) {
  const approvals = useResource<ApprovalList>("/approvals");
  const requests = approvals.data?.approvals ?? [];
  if (approvals.error && !approvals.data) {
    return (
      <p className="notice" data-tone="error">
        {approvals.error}
      </p>
    );
  }
  if (!approvals.data) return null;
  if (requests.length === 0) {
    return (
      <p className="inbox-empty">
        <IconCheck aria-hidden="true" />
        <span>No agent is waiting on a decision.</span>
      </p>
    );
  }
  return (
    <ul className="inbox-list">
      {requests.map((request) => (
        <ApprovalRow
          key={request.id}
          request={request}
          onDecided={() => {
            approvals.refresh();
            onDecided?.();
          }}
        />
      ))}
    </ul>
  );
}

function ReviewRow({
  review,
  changes,
  canPublish,
  onPublished,
}: {
  review: ReviewRequest;
  changes: readonly DraftChangeDto[];
  canPublish: boolean;
  onPublished: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const covered = (review.paths ?? []).map(
    (path) => changes.find((change) => change.path === path) ?? { path },
  );

  async function publish(): Promise<void> {
    setBusy(true);
    try {
      const result = await api<PublishResultDto>("/drafts/publish", {
        method: "POST",
        body: JSON.stringify({ paths: review.paths ?? [], message: review.title }),
      });
      toast.success(
        result.published.length === 0 ? "Already published" : `Published ${review.title}`,
      );
      onPublished();
    } catch (error) {
      toast.error(plainError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="inbox-item">
      {review.url ? (
        <IconExternal className="inbox-icon" aria-hidden="true" />
      ) : (
        <IconWaiting className="inbox-icon" data-tone="waiting" aria-hidden="true" />
      )}
      <div className="inbox-main">
        <p className="inbox-title">{review.title}</p>
        <p className="inbox-sub">
          {review.number !== undefined ? `Pull request #${review.number}` : "Sent for review"}
          {review.requestedBy ? ` by ${review.requestedBy}` : ""},{" "}
          <time dateTime={review.createdAt} title={absoluteTime(review.createdAt)}>
            {relativeTime(review.createdAt)}
          </time>
        </p>
        {covered.length > 0 ? (
          <ul className="inbox-paths" aria-label="What it changes">
            {covered.map((item) =>
              "slug" in item ? (
                <li key={item.path}>
                  <a
                    href={`#/c/${encodeURIComponent(item.collection)}/${encodeURIComponent(item.slug)}`}
                  >
                    {item.title || item.slug}
                  </a>
                </li>
              ) : (
                <li key={item.path}>{item.path}</li>
              ),
            )}
          </ul>
        ) : null}
      </div>
      <div className="inbox-actions">
        {review.url ? (
          <a className="btn" data-size="sm" href={review.url} target="_blank" rel="noreferrer">
            Open on GitHub
          </a>
        ) : canPublish ? (
          <button
            type="button"
            className="btn"
            data-variant="primary"
            data-size="sm"
            disabled={busy}
            onClick={() => void publish()}
          >
            Publish
          </button>
        ) : (
          <span className="inbox-note">Waiting for someone who can publish</span>
        )}
      </div>
    </li>
  );
}

function ApprovalRow({
  request,
  onDecided,
}: {
  request: PendingApprovalDto;
  onDecided: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  const action = describeRequest(request.functionName, request.input);
  // A named action already says what it touches; a bare function shows its inputs.
  const summary = action.startsWith("Run ") ? inputSummary(request.input) : [];

  async function decide(decision: "approved" | "denied"): Promise<void> {
    // Approving lets an irreversible call run, so it is asked twice; denying
    // only sends the agent away.
    if (
      decision === "approved" &&
      !(await confirm({
        kind: "delete",
        title: `Approve “${action}”?`,
        body: "The agent can then run it once. What it deletes or overwrites can't be undone from Studio.",
        action: "Approve",
      }))
    ) {
      return;
    }
    setBusy(true);
    try {
      await api(`/approvals/${encodeURIComponent(request.id)}/decide`, {
        method: "POST",
        body: JSON.stringify({ decision }),
      });
      toast.success(
        decision === "approved"
          ? `Approved: ${action}. The agent can run it now.`
          : `Denied: ${action}`,
      );
      onDecided();
    } catch (error) {
      toast.error(plainError(error));
    } finally {
      setBusy(false);
    }
  }

  const who = request.requestedById
    ? `${request.requestedByKind === "agent" ? "Agent" : "Someone"} ${request.requestedById}`
    : request.requestedByKind === "agent"
      ? "An agent"
      : "Someone";

  return (
    <li className="inbox-item">
      <IconWaiting className="inbox-icon" data-tone="waiting" aria-hidden="true" />
      <div className="inbox-main">
        <p className="inbox-title">{action}</p>
        <p className="inbox-sub">
          {who} asks to run <code>{request.functionName}</code> on {request.branchId},{" "}
          <time dateTime={request.createdAt} title={absoluteTime(request.createdAt)}>
            {relativeTime(request.createdAt)}
          </time>
          . Nothing happens until you decide.
        </p>
        {summary.length > 0 ? (
          <ul className="inbox-paths" aria-label="What it sends">
            {summary.map(([key, value]) => (
              <li key={key}>
                {key}: <code>{value}</code>
              </li>
            ))}
          </ul>
        ) : null}
        <details className="disclosure">
          <summary>Everything it would send</summary>
          <pre className="well">{JSON.stringify(request.input, null, 2)}</pre>
        </details>
      </div>
      <div className="inbox-actions">
        <button
          type="button"
          className="btn"
          data-size="sm"
          disabled={busy}
          onClick={() => void decide("denied")}
        >
          Deny
        </button>
        <button
          type="button"
          className="btn"
          data-variant="primary"
          data-size="sm"
          disabled={busy}
          onClick={() => void decide("approved")}
        >
          Approve
        </button>
      </div>
    </li>
  );
}
