/**
 * The door to a hosted Studio. One screen: create the owner account on the
 * first visit, otherwise sign in with an account, GitHub, Google, single
 * sign-on or a link, and a reason in plain words when the last attempt did
 * not work.
 */
import { useEffect, useState, type FormEvent, type ReactNode } from "react";

const REASONS: Record<string, string> = {
  not_allowed:
    "That GitHub account doesn't have access to this Studio. Ask whoever runs the site to add you.",
  link_expired: "That sign-in link has expired or was already replaced. Ask for a new one.",
  expired: "Sign-in took too long. Try again.",
  github_refused: "GitHub didn't complete the sign-in. Try again.",
  github_off: "Signing in with GitHub isn't set up for this Studio. Use the link you were sent.",
  access_unchecked:
    "Studio couldn't check your access with GitHub. Whoever runs the site can see why in its log.",
  google_not_allowed:
    "That Google account doesn't have access to this Studio. Ask whoever runs the site to invite you.",
  google_refused: "Google didn't complete the sign-in. Try again.",
  google_off: "Signing in with Google isn't set up for this Studio. Sign in another way.",
  oidc_not_allowed:
    "That account doesn't have access to this Studio. Ask whoever runs the site to invite you.",
  oidc_refused:
    "Single sign-on didn't complete. Try again. If it keeps happening, whoever runs the site can see why in its log.",
  oidc_off: "Single sign-on isn't set up for this Studio. Sign in another way.",
  email_unverified:
    "Your sign-on account has no verified email, so Studio can't tell who you are. Verify your email with your provider, then try again.",
};

const ROLE_WORDS: Record<string, string> = {
  viewer: "read everything",
  contributor: "draft changes and submit them for review",
  editor: "draft and publish",
  admin: "draft, publish, approve and invite people",
};

interface SessionInfo {
  methods: {
    github: boolean;
    google?: boolean;
    /** Single sign-on with an OIDC provider, and the provider's name for the button. */
    oidc?: { name: string | null } | null;
    invite: boolean;
    password?: boolean;
  };
  setup: { needsCode: boolean } | null;
}

const AUTH = "/api/studio/v1/auth";

/** POST JSON to an auth route; the server's message (and its fix) when it refuses. */
async function post(path: string, body: Record<string, unknown>): Promise<string | null> {
  try {
    const res = await fetch(`${AUTH}${path}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return null;
    const error = (await res.json().catch(() => null)) as { message?: string; fix?: string } | null;
    return [error?.message, error?.fix].filter(Boolean).join(" ") || "That didn't work. Try again.";
  } catch {
    return "Can't reach Studio. Check your connection and try again.";
  }
}

/** Back into Studio at the page the person was on, minus the sign-in leftovers. */
function enter(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("signin");
  url.searchParams.delete("invite");
  window.location.replace(url.toString());
}

function Card({ title, lede, children }: { title: string; lede: string; children: ReactNode }) {
  return (
    <main className="signin">
      <div className="signin-card">
        <p className="signin-brand wordmark">
          graft.
          <span className="wordmark-sep" aria-hidden="true">
            /
          </span>
          <span className="wordmark-surface">Studio</span>
        </p>
        <h1 className="signin-title">{title}</h1>
        <p className="signin-lede">{lede}</p>
        {children}
      </div>
    </main>
  );
}

/**
 * The session cookie is `Secure` off loopback, and a browser drops a Secure
 * cookie on an address that isn't a secure context: plain http anywhere but
 * localhost. Signing in there succeeds and lands back here with no session,
 * so say so instead of offering a form that can't work.
 */
function sessionWouldBeDropped(): boolean {
  return window.isSecureContext === false;
}

function PlainHttp() {
  return (
    <Card
      title="Sign-in needs https here"
      lede="This address is plain http, so your browser won't keep a sign-in from it, and you'd land back on this screen."
    >
      <p className="signin-invite">
        Open Studio at its https address, or at localhost on the computer that runs it. Whoever runs
        the site can put it behind https.
      </p>
    </Card>
  );
}

function TextField({
  id,
  label,
  help,
  ...input
}: {
  id: string;
  label: string;
  help?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="fr">
      <div className="fr-head">
        <label className="fr-label" htmlFor={id}>
          {label}
        </label>
      </div>
      <input id={id} className="input" {...input} />
      {help ? <p className="fr-help">{help}</p> : null}
    </div>
  );
}

function Problem({ text }: { text: string | null }) {
  return text ? (
    <p className="notice" data-tone="error" role="alert">
      {text}
    </p>
  ) : null;
}

function useSubmit(
  run: (form: FormData) => Promise<string | null>,
): [(e: FormEvent<HTMLFormElement>) => void, boolean, string | null] {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const submit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setProblem(null);
    void run(form).then((refused) => {
      if (refused === null) return enter();
      setBusy(false);
      setProblem(refused);
    });
  };
  return [submit, busy, problem];
}

/** The first visit: nobody has an account yet, so this person becomes the owner. */
function Setup({ needsCode }: { needsCode: boolean }) {
  const [submit, busy, problem] = useSubmit((form) =>
    post("/setup", {
      name: form.get("name"),
      email: form.get("email"),
      password: form.get("password"),
      ...(needsCode ? { code: form.get("code") } : {}),
    }),
  );
  return (
    <Card
      title="Create the owner account"
      lede="You're the first person here. Your account can publish, approve and invite everyone else."
    >
      <Problem text={problem} />
      <form className="signin-form" onSubmit={submit}>
        <TextField id="setup-name" name="name" label="Your name" autoComplete="name" required />
        <TextField
          id="setup-email"
          name="email"
          type="email"
          label="Email"
          autoComplete="email"
          required
        />
        <TextField
          id="setup-password"
          name="password"
          type="password"
          label="Password"
          autoComplete="new-password"
          minLength={10}
          help="At least 10 characters."
          required
        />
        {needsCode ? (
          <TextField
            id="setup-code"
            name="code"
            label="Setup code"
            autoComplete="off"
            spellCheck={false}
            help="Printed when the server starts, or run graft studio setup-code where the site's settings are. It proves you deployed this site."
            required
          />
        ) : null}
        <button type="submit" className="btn signin-submit" data-variant="primary" disabled={busy}>
          {busy ? "Creating…" : "Create account"}
        </button>
      </form>
    </Card>
  );
}

export function SignIn() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const reason = new URLSearchParams(window.location.search).get("signin");

  useEffect(() => {
    fetch(`${AUTH}/session`, { credentials: "same-origin" })
      .then((res) => res.json() as Promise<SessionInfo>)
      .then(setSession)
      .catch(() => setSession({ methods: { github: false, invite: true }, setup: null }));
  }, []);

  const [submit, busy, problem] = useSubmit((form) =>
    post("/sign-in", { email: form.get("email"), password: form.get("password") }),
  );

  if (sessionWouldBeDropped()) return <PlainHttp />;
  if (session?.setup) return <Setup needsCode={session.setup.needsCode} />;

  // Keep the query (the branch being edited), minus the sign-in reason.
  const query = new URLSearchParams(window.location.search);
  query.delete("signin");
  const search = query.toString();
  const returnTo = `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`;
  const password = Boolean(session?.methods.password);
  const oidc = session?.methods.oidc ?? null;
  const google = Boolean(session?.methods.google);
  // The first way to sign in is the primary button, when there's no password form.
  const lead = password
    ? null
    : session?.methods.github
      ? "github"
      : google
        ? "google"
        : oidc
          ? "oidc"
          : null;

  return (
    <Card title="Sign in to edit" lede="Drafts you save here stay drafts until they're published.">
      <Problem text={problem ?? (reason ? (REASONS[reason] ?? null) : null)} />
      {password ? (
        <form className="signin-form" onSubmit={submit}>
          <TextField
            id="signin-email"
            name="email"
            type="email"
            label="Email"
            autoComplete="username"
            required
          />
          <TextField
            id="signin-password"
            name="password"
            type="password"
            label="Password"
            autoComplete="current-password"
            required
          />
          <button
            type="submit"
            className="btn signin-submit"
            data-variant="primary"
            disabled={busy}
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      ) : null}
      {session?.methods.github ? (
        <a
          className="btn signin-provider"
          data-variant={lead === "github" ? "primary" : undefined}
          href={`${AUTH}/github?return=${encodeURIComponent(returnTo)}`}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path
              fill="currentColor"
              d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.06-.49.06-.49.8.06 1.23.83 1.23.83.72 1.22 1.88.87 2.34.66.07-.52.28-.87.5-1.07-1.78-.2-3.65-.89-3.65-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.66 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 8 0Z"
            />
          </svg>
          Continue with GitHub
        </a>
      ) : null}
      {google ? (
        <a
          className="btn signin-provider"
          data-variant={lead === "google" ? "primary" : undefined}
          href={`${AUTH}/google?return=${encodeURIComponent(returnTo)}`}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path
              fill="#4285F4"
              d="M15.68 8.18c0-.57-.05-1.11-.15-1.64H8v3.1h4.3a3.68 3.68 0 0 1-1.6 2.41v2h2.58c1.51-1.39 2.4-3.44 2.4-5.87Z"
            />
            <path
              fill="#34A853"
              d="M8 16c2.16 0 3.97-.72 5.29-1.94l-2.58-2a4.8 4.8 0 0 1-7.16-2.52H.89v2.07A8 8 0 0 0 8 16Z"
            />
            <path
              fill="#FBBC05"
              d="M3.55 9.54a4.8 4.8 0 0 1 0-3.08V4.39H.89a8 8 0 0 0 0 7.22l2.66-2.07Z"
            />
            <path
              fill="#EA4335"
              d="M8 3.18c1.17 0 2.23.4 3.06 1.2l2.29-2.3A7.68 7.68 0 0 0 8 0 8 8 0 0 0 .89 4.39l2.66 2.07A4.77 4.77 0 0 1 8 3.18Z"
            />
          </svg>
          Continue with Google
        </a>
      ) : null}
      {oidc ? (
        <a
          className="btn signin-provider"
          data-variant={lead === "oidc" ? "primary" : undefined}
          href={`${AUTH}/oidc?return=${encodeURIComponent(returnTo)}`}
        >
          {oidc.name ? `Continue with ${oidc.name}` : "Continue with single sign-on"}
        </a>
      ) : null}
      <p className="signin-invite">
        {password
          ? "No account? Ask whoever runs the site to invite you. Forgotten your password? An admin can send you a link to set a new one."
          : `${session?.methods.github || google || oidc ? "Or open" : "Open"} the sign-in link you were sent, in this browser. Links come from whoever runs the site.`}
      </p>
    </Card>
  );
}

interface InviteInfo {
  email: string;
  name: string | null;
  role: string;
  /** For someone who can already sign in: the link sets a new password. */
  reset: boolean;
}

/** An invitation link: choose a password, and the account exists. */
export function AcceptInvite({ token }: { token: string }) {
  const [invite, setInvite] = useState<InviteInfo | null | "invalid">(null);
  useEffect(() => {
    fetch(`${AUTH}/invite?token=${encodeURIComponent(token)}`, { credentials: "same-origin" })
      .then(async (res) => (res.ok ? ((await res.json()) as InviteInfo) : "invalid"))
      .then(setInvite)
      .catch(() => setInvite("invalid"));
  }, [token]);

  const [submit, busy, problem] = useSubmit((form) =>
    post("/invite", { token, name: form.get("name"), password: form.get("password") }),
  );

  // Before the form, so the link stays unused until it can sign someone in.
  if (sessionWouldBeDropped()) return <PlainHttp />;
  if (invite === "invalid") {
    return (
      <Card
        title="This link can't be used"
        lede="It was already used, replaced by a newer one, or it has expired. Ask whoever sent it for a new one."
      >
        <a className="btn signin-submit" href={window.location.pathname}>
          Go to sign in
        </a>
      </Card>
    );
  }
  if (!invite)
    return (
      <Card title="Join this Studio" lede="Checking your invitation…">
        {null}
      </Card>
    );

  if (invite.reset) {
    return (
      <Card
        title="Choose a new password"
        lede={`For ${invite.email}. Every browser signed in as you will be signed out.`}
      >
        <Problem text={problem} />
        <form className="signin-form" onSubmit={submit}>
          <input type="email" autoComplete="username" value={invite.email} readOnly hidden />
          <TextField
            id="reset-password"
            name="password"
            type="password"
            label="New password"
            autoComplete="new-password"
            minLength={10}
            help="At least 10 characters."
            required
          />
          <button
            type="submit"
            className="btn signin-submit"
            data-variant="primary"
            disabled={busy}
          >
            {busy ? "Saving…" : "Set password and sign in"}
          </button>
        </form>
      </Card>
    );
  }

  return (
    <Card
      title="Join this Studio"
      lede={`You're invited as ${invite.email}. You'll be able to ${ROLE_WORDS[invite.role] ?? "edit"}.`}
    >
      <Problem text={problem} />
      <form className="signin-form" onSubmit={submit}>
        {/* For password managers: the account this password belongs to. */}
        <input type="email" autoComplete="username" value={invite.email} readOnly hidden />
        <TextField
          id="invite-name"
          name="name"
          label="Your name"
          autoComplete="name"
          defaultValue={invite.name ?? ""}
          required
        />
        <TextField
          id="invite-password"
          name="password"
          type="password"
          label="Choose a password"
          autoComplete="new-password"
          minLength={10}
          help="At least 10 characters."
          required
        />
        <button type="submit" className="btn signin-submit" data-variant="primary" disabled={busy}>
          {busy ? "Joining…" : "Join"}
        </button>
      </form>
    </Card>
  );
}
