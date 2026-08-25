# [BUG] Tokens without a `sub` claim yield actors with undefined identity, degrading rate limiting and audit attribution

**File:** [`packages/auth/src/oidc.ts`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/packages/auth/src/oidc.ts#L105-L108) (lines 105, 106, 107, 108)
**Project:** graft
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-auth-attribution-gap`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

IssuerVerifier.verify() builds the FunctionActor as `id: payload.sub` (line ~107) without requiring `sub` (no `requiredClaims` passed to jwtVerify). jose does not mandate `sub`, so a signature-valid token from a trusted issuer that omits it authenticates successfully as `{ kind: <actorKind>, id: undefined, scopes: [...] }`. Downstream, createFunctionsHandler derives its rate identity as `${actor.kind}:${actor.id ?? ip}` (functions-handler.ts:218), so every sub-less actor silently collapses into a client-IP-keyed bucket (shared across all users behind one NAT/proxy, and trivially rotated by attackers), while audit rows and approval records persist `null` actorId — breaking the 'stable identity for non-anonymous actors' invariant documented on FunctionActor and weakening forensic attribution of privileged invocations. Impact is limited because scope-based access rules still apply, so this is a correctness/attribution bug rather than an escalation.

## Recommendation

Pass `requiredClaims: ['sub']` to jwtVerify (rejecting sub-less tokens as TOKEN_INVALID), or coerce a deterministic fallback identity and document it; alternatively treat actors with no id as a distinct kind so rate limiting and audit don't silently fall back to client IP.

## Revalidation

**Verdict:** true-positive

Every link in the chain is confirmed in source. IssuerVerifier.verify() calls jwtVerify(token, getKey, { issuer, audience }) with no requiredClaims (none exists anywhere in the repo), and jose v6 treats `sub` as optional — so a signature-valid, iss-matching token without `sub` authenticates successfully and returns { kind, id: undefined }. resolver.ts passes the actor through unchanged with no identity check. Downstream, functions-handler.ts:217-218 derives rateKey as `${actor.kind}:${actor.id ?? ip}` for non-anonymous actors, so every sub-less caller collapses into a bucket keyed by clientIp(), which trusts attacker-suppliable x-forwarded-for/x-real-ip — meaning the rate identity is shared across users behind one egress AND freely rotated by any single holder of a valid sub-less token, defeating the per-caller limit entirely. Audit rows persist actorId: actor?.id ?? null (functions-handler.ts:391) and approval requests persist requestedById: null, breaking FunctionActor's documented 'stable identity' contract for non-anonymous actors and weakening forensic attribution of privileged/destructive invocations. Triggering is realistic rather than hypothetical: OIDC access tokens and machine/service tokens frequently omit `sub`, and nothing constrains issuers to mint ID-token semantics. Scope enforcement still applies, so there is no privilege escalation — consistent with the finding's self-assessment as an attribution/rate-limiting correctness bug rather than an auth bypass. Real defect with deterministic consequences; BUG severity is correct.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-09)
