/**
 * @graft/auth
 *
 * Graft verifies identity; it doesn't mint it. This package turns a request
 * into a FunctionActor (createActorResolver) by verifying bearer JWTs against
 * trusted OIDC issuers — a Better Auth instance the app hosts (the default
 * engine; see betterAuthIssuer), a company IdP, Vercel Connect/Passport — plus
 * static dev tokens for local bootstrap. requireScopes turns token scopes into
 * function access rules.
 *
 * Later units add: the audit log riding correlationId (P3.4), rate limits, and
 * the human gate for destructive ops.
 */
export * from "./oidc";
export * from "./resolver";
export * from "./scopes";
