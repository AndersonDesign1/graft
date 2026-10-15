/**
 * Agents: the tokens that let an agent read or edit this site's content, over
 * MCP or the Studio API. An admin makes one per agent, names it after the
 * agent, and picks how far it may go. The token is shown once; what is
 * stored is its hash, so a lost token is revoked and replaced, never shown
 * again. Revoked tokens stay listed: what was given out stays on record.
 */
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import type { AgentAccess, AgentsDto, AgentTokenDto, NewAgentTokenDto } from "../../editor-types";
import { IconCaretDown, IconInfo } from "../components/icons";
import { CopyButton, Row, Section } from "../components/set-row";
import { useConfirm } from "../components/ui/confirm";
import { api, plainError } from "../lib/api";
import { absoluteTime, relativeTime } from "../lib/format";
import { useResource } from "../lib/use-resource";

const ACCESS: Array<{ id: AgentAccess; label: string; can: string }> = [
  { id: "read", label: "Read", can: "Reads content, never changes it" },
  { id: "write", label: "Write drafts", can: "Writes drafts; a person publishes them" },
  { id: "publish", label: "Publish", can: "Writes and publishes" },
];

function accessLabel(token: AgentTokenDto): string {
  return ACCESS.find((a) => a.id === token.access)?.label ?? token.scopes.join(", ");
}

export function AgentsView() {
  const agents = useResource<AgentsDto>("/agents");
  const [fresh, setFresh] = useState<NewAgentTokenDto | null>(null);
  const live = agents.data?.tokens.filter((t) => !t.revokedAt) ?? [];
  const revoked = agents.data?.tokens.filter((t) => t.revokedAt) ?? [];

  return (
    <div className="view view-settings">
      <header className="view-head">
        <div>
          <h1 className="view-title">Agents</h1>
          <p className="view-sub">
            Tokens that let an agent work on this site's content. Give each agent its own, so you
            can tell what it did and switch it off alone.
          </p>
        </div>
      </header>

      {agents.error ? (
        <p className="notice" data-tone="error">
          {agents.error}
        </p>
      ) : null}

      {agents.data && !agents.data.accepted ? (
        <p className="notice">
          <IconInfo size={14} />
          <span>
            This Studio runs on this computer, which has no MCP endpoint. Tokens made here work
            where the site runs <code>graft serve</code> on the same database.
          </span>
        </p>
      ) : null}

      <div className="settings-sections">
        <Section
          id="connect"
          title="Connect an agent"
          sub="Point the agent at the MCP endpoint and send its token as a bearer header."
        >
          <div className="set-panel">
            <Row label="MCP endpoint" hint="Any MCP client connects here.">
              {agents.data ? (
                <>
                  <code className="set-value">{agents.data.endpoints.mcp}</code>
                  <CopyButton value={agents.data.endpoints.mcp} />
                </>
              ) : null}
            </Row>
            <Row label="Header" hint="Every request carries the token.">
              <code className="set-value">Authorization: Bearer graft_at_…</code>
            </Row>
          </div>
        </Section>

        <Section
          id="tokens"
          title="Tokens"
          sub="An agent never decides approvals: deleting and other destructive calls still wait for a person in the inbox."
        >
          <div className="set-panel">
            <NewToken
              onMade={(made) => {
                setFresh(made);
                agents.refresh();
              }}
            />
            {fresh ? (
              <Row label={`${fresh.name}'s token`} stack>
                <div className="people-link" role="status">
                  <p className="set-row-hint">
                    Copy it now and give it to the agent. This is the only time it's shown.
                  </p>
                  <div className="people-link-value">
                    <code className="set-value">{fresh.token}</code>
                    <CopyButton value={fresh.token} />
                  </div>
                </div>
              </Row>
            ) : null}
            {live.map((token) => (
              <TokenRow
                key={token.id}
                token={token}
                onRevoked={() => {
                  if (fresh?.id === token.id) setFresh(null);
                  agents.refresh();
                }}
              />
            ))}
            {agents.data && live.length === 0 ? (
              <Row label="No tokens yet" hint="Make one above for each agent that should get in." />
            ) : null}
          </div>
          {revoked.length > 0 ? (
            <details className="disclosure agents-revoked">
              <summary>
                {revoked.length === 1 ? "1 revoked token" : `${revoked.length} revoked tokens`}
              </summary>
              <div className="set-panel">
                {revoked.map((token) => (
                  <Row
                    key={token.id}
                    label={token.name}
                    hint={`${accessLabel(token)} · revoked ${relativeTime(token.revokedAt ?? token.createdAt)}`}
                  />
                ))}
              </div>
            </details>
          ) : null}
        </Section>
      </div>
    </div>
  );
}

function NewToken({ onMade }: { onMade: (made: NewAgentTokenDto) => void }) {
  const [access, setAccess] = useState<AgentAccess>("write");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const form = e.currentTarget;
    const name = new FormData(form).get("name");
    setBusy(true);
    setProblem(null);
    api<NewAgentTokenDto>("/agents", {
      method: "POST",
      body: JSON.stringify({ name, access }),
    })
      .then((made) => {
        form.reset();
        onMade(made);
      })
      .catch((error: unknown) => setProblem(plainError(error)))
      .finally(() => setBusy(false));
  };

  return (
    <Row label="New token" hint={ACCESS.find((a) => a.id === access)?.can ?? ""} stack>
      <form className="people-invite" onSubmit={submit}>
        <input
          className="input"
          name="name"
          placeholder="Which agent, e.g. Docs writer"
          aria-label="Name"
          autoComplete="off"
          maxLength={80}
          required
        />
        <div className="fc-select people-role">
          <select
            className="input"
            aria-label="Access"
            value={access}
            onChange={(e) => setAccess(ACCESS.find((a) => a.id === e.target.value)?.id ?? "write")}
          >
            {ACCESS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <IconCaretDown size={14} className="fc-select-caret" aria-hidden="true" />
        </div>
        <button type="submit" className="btn" data-variant="primary" disabled={busy}>
          {busy ? "Making…" : "Make token"}
        </button>
      </form>
      {problem ? (
        <p className="notice" data-tone="error" role="alert">
          {problem}
        </p>
      ) : null}
    </Row>
  );
}

function TokenRow({ token, onRevoked }: { token: AgentTokenDto; onRevoked: () => void }) {
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const used = token.lastUsedAt ? `used ${relativeTime(token.lastUsedAt)}` : "never used";

  const revoke = async (): Promise<void> => {
    const ok = await confirm({
      kind: "delete",
      title: `Revoke ${token.name}'s token?`,
      body: "The agent is refused from its next request. Make a new token if it should get back in.",
      action: "Revoke token",
    });
    if (!ok) return;
    setBusy(true);
    api(`/agents/${token.id}`, { method: "DELETE" })
      .then(() => toast.success(`${token.name}'s token is revoked.`))
      .catch((error: unknown) => toast.error(plainError(error)))
      .finally(() => {
        setBusy(false);
        onRevoked();
      });
  };

  return (
    <Row label={token.name} hint={`${accessLabel(token)} · ${token.prefix}… · ${used}`}>
      <span className="muted" title={absoluteTime(token.createdAt)}>
        Made {relativeTime(token.createdAt)}
      </span>
      <button
        type="button"
        className="btn"
        data-size="sm"
        disabled={busy}
        onClick={() => void revoke()}
      >
        Revoke
      </button>
    </Row>
  );
}
