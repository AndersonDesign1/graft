/**
 * Better Auth — the identity engine this example hosts (the @graft/auth
 * default). It owns its own tables in the same Neon database (user, session,
 * account, verification, jwks) and mints the JWTs that @graft/auth verifies:
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

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  database: new Pool({ connectionString: process.env.DATABASE_URL }),
  emailAndPassword: { enabled: true },
  plugins: [
    jwt({
      jwt: {
        // Scopes ride the standard OAuth2 `scope` claim (space-separated),
        // which @graft/auth reads into actor.scopes. Every signed-in account
        // gets submissions:read here — an example-sized policy; real
        // deployments derive scopes from roles/grants (P3.4).
        definePayload: ({ user }) => ({ email: user.email, scope: "submissions:read" }),
      },
    }),
  ],
});
