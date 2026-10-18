---
"@usegraft/studio": minor
---

A hosted Studio can sign people in with an OpenID Connect provider: your app's Better Auth (with `@better-auth/oauth-provider`), Okta, Entra ID, Google Workspace, Keycloak and others. Set `GRAFT_OIDC_ISSUER`, `GRAFT_OIDC_CLIENT_ID` and `GRAFT_OIDC_CLIENT_SECRET`, and optionally `GRAFT_OIDC_NAME` for the button. Studio runs the authorization code flow with PKCE and checks the ID token's signature, issuer, audience, expiry and nonce. Only a verified email counts: someone with a Studio account signs in as that account, someone invited from Settings, People gets their account on their first sign-in (no link and no password needed), someone on `GRAFT_STUDIO_EDITORS` gets the role it gives, and anyone else is refused.
