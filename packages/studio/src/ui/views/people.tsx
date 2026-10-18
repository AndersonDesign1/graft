/**
 * Settings' Account and People sections, shown when Studio has accounts.
 *
 * People is for admins: who can sign in, as what, and invitations nobody has
 * used yet. An invitation is a link the admin passes on; Studio sends no
 * email, so the link is shown once, with a copy button. With single sign-on,
 * the invitation is enough on its own: the person signs in with the provider.
 */
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import type { InviteDto, PeopleDto, PersonDto, StudioRoleName } from "../../editor-types";
import { IconCaretDown, IconTrash } from "../components/icons";
import { CopyButton, Row } from "../components/set-row";
import { useConfirm } from "../components/ui/confirm";
import { api, plainError } from "../lib/api";
import { useResource } from "../lib/use-resource";

const ROLES: Array<{ id: StudioRoleName; label: string; can: string }> = [
  { id: "viewer", label: "Viewer", can: "Reads everything" },
  { id: "contributor", label: "Contributor", can: "Drafts and submits for review" },
  { id: "editor", label: "Editor", can: "Drafts and publishes" },
  { id: "admin", label: "Admin", can: "Publishes, approves, invites people and runs the site" },
];

function RoleSelect({
  id,
  value,
  label,
  disabled,
  onChange,
}: {
  id: string;
  value: StudioRoleName;
  label: string;
  disabled?: boolean;
  onChange: (role: StudioRoleName) => void;
}) {
  return (
    <div className="fc-select people-role">
      <select
        id={id}
        className="input"
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as StudioRoleName)}
      >
        {ROLES.map((role) => (
          <option key={role.id} value={role.id}>
            {role.label}
          </option>
        ))}
      </select>
      <IconCaretDown size={14} className="fc-select-caret" aria-hidden="true" />
    </div>
  );
}

function expires(invite: InviteDto): string {
  const date = new Date(invite.expiresAt).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
  const role = ROLES.find((r) => r.id === invite.role)?.label.toLowerCase() ?? invite.role;
  return `Invited as ${role}. The link works until ${date}.`;
}

/** The single sign-on button's words, when this Studio has single sign-on. */
function useSingleSignOn(): string | null {
  const session = useResource<{ methods?: { oidc?: { name: string | null } | null } }>(
    "/auth/session",
  );
  const oidc = session.data?.methods?.oidc;
  if (!oidc) return null;
  return oidc.name ? `Continue with ${oidc.name}` : "Continue with single sign-on";
}

function InviteForm({ onInvited, sso }: { onInvited: () => void; sso: string | null }) {
  const [role, setRole] = useState<StudioRoleName>("editor");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [link, setLink] = useState<{ email: string; url: string } | null>(null);

  const submit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setProblem(null);
    api<{ invite: InviteDto; url: string }>("/people/invites", {
      method: "POST",
      body: JSON.stringify({ email: data.get("email"), name: data.get("name"), role }),
    })
      .then((result) => {
        setLink({ email: result.invite.email, url: result.url });
        form.reset();
        onInvited();
      })
      .catch((error: unknown) => setProblem(plainError(error)))
      .finally(() => setBusy(false));
  };

  return (
    <Row
      label="Invite someone"
      hint={
        sso
          ? `They can press ${sso} on the sign-in screen, or use a link to choose a password. Studio doesn't send email, so tell them yourself.`
          : "They get a link to choose a password. Studio doesn't send email, so pass the link on yourself."
      }
      stack
    >
      <form className="people-invite" onSubmit={submit}>
        <input
          className="input"
          name="email"
          type="email"
          placeholder="Email"
          aria-label="Email"
          autoComplete="off"
          required
        />
        <input className="input" name="name" placeholder="Name (optional)" aria-label="Name" />
        <RoleSelect id="invite-role" value={role} label="Role" onChange={setRole} />
        <button type="submit" className="btn" data-variant="primary" disabled={busy}>
          {busy ? "Inviting…" : "Invite"}
        </button>
      </form>
      {problem ? (
        <p className="notice" data-tone="error" role="alert">
          {problem}
        </p>
      ) : null}
      {link ? (
        <div className="people-link" role="status">
          <p className="set-row-hint">
            {sso
              ? `${link.email} can now press ${sso} on the sign-in screen. Or send them this link, privately, to choose a password instead. It works once, for 7 days, and this is the only time it's shown.`
              : `Send this link to ${link.email}, privately. It works once, for 7 days, and this is the only time it's shown.`}
          </p>
          <div className="people-link-value">
            <code className="set-value">{link.url}</code>
            <CopyButton value={link.url} />
          </div>
        </div>
      ) : null}
    </Row>
  );
}

function PersonRow({ person, onChanged }: { person: PersonDto; onChanged: () => void }) {
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const name = person.name ?? person.email;
  const notes = [person.email, person.owner ? "Owner" : null, person.you ? "You" : null]
    .filter(Boolean)
    .join(" · ");

  const change = (role: StudioRoleName): void => {
    setBusy(true);
    api(`/people/${person.id}`, { method: "PUT", body: JSON.stringify({ role }) })
      .then(() => toast.success(`${name} is now ${role === "admin" ? "an" : "a"} ${role}.`))
      .catch((error: unknown) => toast.error(plainError(error)))
      .finally(() => {
        setBusy(false);
        onChanged();
      });
  };

  const [reset, setReset] = useState<string | null>(null);
  const makeReset = (): void => {
    setBusy(true);
    api<{ url: string }>(`/people/${person.id}/reset`, { method: "POST", body: "{}" })
      .then((result) => setReset(result.url))
      .catch((error: unknown) => toast.error(plainError(error)))
      .finally(() => setBusy(false));
  };

  const remove = async (): Promise<void> => {
    const ok = await confirm({
      kind: "delete",
      title: `Remove ${name}'s access?`,
      body: "They're signed out now and can't sign in again unless someone invites them. What they wrote stays attributed to them.",
      action: `Remove ${name}`,
    });
    if (!ok) return;
    setBusy(true);
    api(`/people/${person.id}`, { method: "DELETE" })
      .then(() => toast.success(`${name} can no longer sign in.`))
      .catch((error: unknown) => toast.error(plainError(error)))
      .finally(() => {
        setBusy(false);
        onChanged();
      });
  };

  return (
    <>
      <Row label={name} hint={notes}>
        {person.you ? null : (
          <button type="button" className="btn" data-size="sm" disabled={busy} onClick={makeReset}>
            Reset password
          </button>
        )}
        <RoleSelect
          id={`role-${person.id}`}
          value={person.role}
          label={`${name}'s role`}
          disabled={busy}
          onChange={change}
        />
        <button
          type="button"
          className="btn"
          data-size="icon"
          data-variant="ghost"
          aria-label={`Remove ${name}`}
          title={person.you ? "You can't remove yourself" : `Remove ${name}`}
          disabled={busy || person.you}
          onClick={() => void remove()}
        >
          <IconTrash />
        </button>
      </Row>
      {reset ? (
        <Row
          label={`A link for ${name} to set a new password`}
          hint="Send it privately. It works once, for 7 days, keeps their role, and signs out their other browsers. This is the only time it's shown."
          stack
        >
          <div className="people-link-value" role="status">
            <code className="set-value">{reset}</code>
            <CopyButton value={reset} />
          </div>
        </Row>
      ) : null}
    </>
  );
}

function InviteRow({ invite, onChanged }: { invite: InviteDto; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Row
      label={invite.name ? `${invite.name} (${invite.email})` : invite.email}
      hint={expires(invite)}
    >
      <button
        type="button"
        className="btn"
        data-size="sm"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          api(`/people/invites/${invite.id}`, { method: "DELETE" })
            .then(() => toast.success(`The invitation to ${invite.email} no longer works.`))
            .catch((error: unknown) => toast.error(plainError(error)))
            .finally(() => {
              setBusy(false);
              onChanged();
            });
        }}
      >
        Revoke
      </button>
    </Row>
  );
}

export function PeoplePanel() {
  const people = useResource<PeopleDto>("/people");
  const sso = useSingleSignOn();
  const refresh = (): void => void people.refresh();
  return (
    <div className="set-panel">
      <InviteForm onInvited={refresh} sso={sso} />
      {people.error ? (
        <Row label="Couldn't load people" hint={people.error} />
      ) : (
        <>
          {people.data?.people.map((person) => (
            <PersonRow key={person.id} person={person} onChanged={refresh} />
          ))}
          {people.data?.invites.map((invite) => (
            <InviteRow key={invite.id} invite={invite} onChanged={refresh} />
          ))}
        </>
      )}
    </div>
  );
}

/** Your own account: who you're signed in as, and your password. */
/**
 * Your own account. Someone who signs in only with GitHub, Google or single
 * sign-on has no password, so there is none to change; an admin can make
 * them a link to set one.
 */
export function AccountPanel({
  email,
  role,
  password,
}: {
  email: string;
  role: string;
  password: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setProblem(null);
    fetch("/api/studio/v1/auth/password", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ current: data.get("current"), next: data.get("next") }),
    })
      .then(async (res) => {
        if (res.ok) {
          form.reset();
          toast.success("Password changed. Other browsers signed in as you are signed out.");
          return;
        }
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        setProblem(body?.message ?? "That didn't work. Try again.");
      })
      .catch(() => setProblem("Can't reach Studio. Check your connection and try again."))
      .finally(() => setBusy(false));
  };

  return (
    <div className="set-panel">
      <Row label="Signed in as" hint={ROLES.find((r) => r.id === role)?.can}>
        <code className="set-value">{email}</code>
      </Row>
      {password ? (
        <Row
          label="Password"
          hint="At least 10 characters. Changing it signs out your other browsers."
          stack
        >
          <form className="people-password" onSubmit={submit}>
            <input type="email" autoComplete="username" value={email} readOnly hidden />
            <input
              className="input"
              name="current"
              type="password"
              placeholder="Current password"
              aria-label="Current password"
              autoComplete="current-password"
              required
            />
            <input
              className="input"
              name="next"
              type="password"
              placeholder="New password"
              aria-label="New password"
              autoComplete="new-password"
              minLength={10}
              required
            />
            <button type="submit" className="btn" disabled={busy}>
              {busy ? "Changing…" : "Change password"}
            </button>
          </form>
          {problem ? (
            <p className="notice" data-tone="error" role="alert">
              {problem}
            </p>
          ) : null}
        </Row>
      ) : null}
    </div>
  );
}
