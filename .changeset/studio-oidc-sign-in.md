---
"@usegraft/studio": minor
---

A hosted Studio can sign people in with Google, and with any other OpenID Connect provider: Okta, Entra ID, Keycloak, your app's own Better Auth (with `@better-auth/oauth-provider`) and others. Set `GRAFT_GOOGLE_CLIENT_ID` and `GRAFT_GOOGLE_CLIENT_SECRET` for "Continue with Google", or `GRAFT_OIDC_ISSUER`, `GRAFT_OIDC_CLIENT_ID` and `GRAFT_OIDC_CLIENT_SECRET` (and `GRAFT_OIDC_NAME` for the button) for another provider. Studio runs the authorization code flow with PKCE and checks the ID token's signature, issuer, audience, expiry and nonce, and only a verified email counts.

Settings, People is now the one place to add someone, however they sign in. A person invited there signs in with GitHub, Google or single sign-on as their Studio account, and their first sign-in uses the invitation: no link to pass on, no password to choose. GitHub matches any verified address on the person's account. Someone signed in as an account with no password sees no password to change in Settings.
