/**
 * The door to a hosted Studio. One screen, two ways in, and a reason in plain
 * words when the last attempt did not work.
 */
import { useEffect, useState } from "react";

const REASONS: Record<string, string> = {
  not_allowed:
    "That GitHub account doesn't have access to this Studio. Ask whoever runs the site to add you.",
  link_expired: "That sign-in link has expired or was already replaced. Ask for a new one.",
  expired: "Sign-in took too long. Try again.",
  github_refused: "GitHub didn't complete the sign-in. Try again.",
  github_off: "Signing in with GitHub isn't set up for this Studio. Use the link you were sent.",
};

interface SessionInfo {
  methods: { github: boolean; invite: boolean };
}

export function SignIn() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const reason = new URLSearchParams(window.location.search).get("signin");

  useEffect(() => {
    fetch("/api/studio/v1/auth/session", { credentials: "same-origin" })
      .then((res) => res.json() as Promise<SessionInfo>)
      .then(setSession)
      .catch(() => setSession({ methods: { github: false, invite: true } }));
  }, []);

  // Keep the query (the branch being edited), minus the sign-in reason.
  const query = new URLSearchParams(window.location.search);
  query.delete("signin");
  const search = query.toString();
  const returnTo = `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`;

  return (
    <main className="signin">
      <div className="signin-card">
        <p className="signin-brand">
          graft<b>.</b> <span>studio</span>
        </p>
        <h1 className="signin-title">Sign in to edit.</h1>
        <p className="signin-lede">Drafts you save here are yours until you publish them.</p>
        {reason && REASONS[reason] ? (
          <p className="notice" data-tone="error" role="alert">
            {REASONS[reason]}
          </p>
        ) : null}
        {session?.methods.github ? (
          <a
            className="btn signin-github"
            data-variant="primary"
            href={`/api/studio/v1/auth/github?return=${encodeURIComponent(returnTo)}`}
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
        <p className="signin-invite">
          {session?.methods.github ? "No GitHub account? " : ""}Open the sign-in link you were sent,
          in this browser. Links come from whoever runs the site.
        </p>
      </div>
    </main>
  );
}
