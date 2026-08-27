/**
 * Better Auth — the identity engine this example hosts (the @usegraft/auth
 * default). It owns its own tables in the same Neon database (user, session,
 * account, verification, jwks) and mints the JWTs that @usegraft/auth verifies:
 *
 *   1. sign in        → POST /api/auth/sign-in/email  (session cookie)
 *   2. mint a JWT     → GET  /api/auth/token          → { token }
 *   3. call functions → POST /api/fn/<name> with `Authorization: Bearer <token>`
 *
 * Keys live at GET /api/auth/jwks; the functions route trusts this instance
 * via betterAuthIssuer() — the exact same verifier path an external IdP
 * (Vercel Connect/Passport) would use.
 */
import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";
import { Pool } from "pg";

/**
 * Accounts that receive operator scopes, by email, from the environment.
 *
 * Sign-up is open (that is the point of the demo), so scopes cannot ride on
 * "is signed in". This example previously stamped EVERY self-registered
 * account with `submissions:read commerce:orders:read commerce:orders:write`,
 * which meant one free signup could dump every contact submission and mark
 * arbitrary orders paid or fulfilled. A real deployment reads roles or grants
 * from its own tables; an allowlist keeps that idea legible without a schema.
 */
const OPERATOR_EMAILS = new Set(
  (process.env.GRAFT_OPERATOR_EMAILS ?? "")
    .split(/[,\s]+/)
    .filter(Boolean)
    .map((email) => email.toLowerCase()),
);

/** Operator scopes. Content authoring and approvals are NOT among them. */
const OPERATOR_SCOPE = "submissions:read commerce:orders:read commerce:orders:write";

/**
 * Explain the empty scope once, when it is first earned.
 *
 * The default is correct and stays: an unset GRAFT_OPERATOR_EMAILS grants
 * nobody anything. It is also the single most confusing thing about demoing
 * this app, because the symptom is a bare 401 from a function that looks like
 * it should work, and nothing connects that to a variable you did not set.
 *
 * Deliberately not a module-scope warning. This file is evaluated during
 * `next build`, where the variable is legitimately absent and a warning is
 * noise — the same reason BETTER_AUTH_SECRET is set to a throwaway in CI.
 * Firing here means it fires exactly when a real person signs in and gets
 * nothing.
 */
let explainedEmptyScope = false;
function explainEmptyScope(email: string): void {
  if (explainedEmptyScope) return;
  explainedEmptyScope = true;
  const configured = OPERATOR_EMAILS.size > 0;
  console.warn(
    `[graft] minted a token for ${email} with no scopes, so gated functions will answer 401.\n` +
      (configured
        ? `[graft] GRAFT_OPERATOR_EMAILS is set but does not list this address.\n`
        : `[graft] GRAFT_OPERATOR_EMAILS is unset, so no account has scopes.\n`) +
      `[graft] To grant them: GRAFT_OPERATOR_EMAILS=${email}\n` +
      `[graft] Scopes granted: ${OPERATOR_SCOPE}`,
  );
}

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  database: new Pool({ connectionString: process.env.DATABASE_URL }),
  emailAndPassword: { enabled: true },
  plugins: [
    jwt({
      jwt: {
        // Scopes ride the standard OAuth2 `scope` claim (space-separated),
        // which @usegraft/auth reads into actor.scopes. Being signed in earns
        // nothing: an account gets scopes only by being named in
        // GRAFT_OPERATOR_EMAILS. Consider also requiring email verification
        // before minting tokens once this app has a mail sender.
        definePayload: ({ user }) => {
          const operator = OPERATOR_EMAILS.has(user.email.toLowerCase());
          if (!operator) explainEmptyScope(user.email);
          return { email: user.email, scope: operator ? OPERATOR_SCOPE : "" };
        },
      },
    }),
  ],
});
