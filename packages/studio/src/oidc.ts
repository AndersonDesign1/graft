/**
 * Sign-in with an OpenID Connect provider: a Better Auth instance running its
 * OAuth provider plugin, Okta, Entra ID, Google Workspace, Keycloak and the
 * rest. Studio runs the authorization code flow with PKCE, then checks the ID
 * token itself: its signature against the provider's published keys, the
 * issuer, the audience, the expiry, and the nonce this sign-in started with.
 *
 * Nothing is cached. A sign-in reads the provider's metadata and keys fresh,
 * so a rotated key or a moved endpoint never strands anyone, and sign-ins are
 * rare enough that the extra requests cost nothing anyone notices.
 */
import { createHash, randomBytes } from "node:crypto";
import { withoutTrailingSlashes } from "@usegraft/compiler";
import {
  createLocalJWKSet,
  decodeProtectedHeader,
  jwtVerify,
  type JSONWebKeySet,
  type JWTPayload,
} from "jose";

export interface OidcSignInOptions {
  /** The provider's issuer URL, exactly as its tokens name it. */
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** The provider's name on the sign-in button ("Continue with Acme"). */
  name?: string;
  /** Other spellings of the issuer its ID tokens may carry. */
  issuerAliases?: readonly string[];
  fetch?: typeof fetch;
}

/** Google, as an OpenID Connect provider. */
export function googleProvider(client: {
  clientId: string;
  clientSecret: string;
  fetch?: typeof fetch;
}): OidcSignInOptions {
  return {
    ...client,
    issuer: "https://accounts.google.com",
    name: "Google",
    // Google's ID tokens name their issuer with or without the scheme.
    issuerAliases: ["accounts.google.com"],
  };
}

/** Who the provider says signed in. */
export interface OidcPerson {
  sub: string;
  email?: string;
  /** Only a verified email can stand for a person: anyone can type one in. */
  emailVerified: boolean;
  name?: string;
}

interface ProviderMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  /**
   * Required by the spec, but a provider that signs ID tokens only with the
   * client secret has no keys to publish, and Better Auth leaves it out then.
   */
  jwks_uri?: string;
  userinfo_endpoint?: string;
  token_endpoint_auth_methods_supported?: string[];
}

const SCOPES = "openid email profile";

async function discover(options: OidcSignInOptions): Promise<ProviderMetadata> {
  const doFetch = options.fetch ?? fetch;
  const issuer = withoutTrailingSlashes(options.issuer);
  const url = `${issuer}/.well-known/openid-configuration`;
  const response = await doFetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  // SAFETY: Partial, and every field used is checked just below.
  const metadata = (await response.json()) as Partial<ProviderMetadata>;
  // The metadata must be about the issuer that was configured, or a provider
  // could hand out tokens in another's name (the OpenID mix-up attack).
  if (typeof metadata.issuer !== "string" || withoutTrailingSlashes(metadata.issuer) !== issuer) {
    throw new Error(`${url} names the issuer "${metadata.issuer}", not "${options.issuer}"`);
  }
  for (const key of ["authorization_endpoint", "token_endpoint"] as const) {
    if (typeof metadata[key] !== "string") throw new Error(`${url} has no ${key}`);
  }
  // SAFETY: the issuer and both required endpoints were checked to be strings above.
  return metadata as ProviderMetadata;
}

function base64url(bytes: Buffer): string {
  return bytes.toString("base64url");
}

/** Where to send the browser, and the two secrets the callback must hold up. */
export async function startOidcSignIn(
  options: OidcSignInOptions,
  { redirectUri, state }: { redirectUri: string; state: string },
): Promise<{ url: string; verifier: string; nonce: string }> {
  const metadata = await discover(options);
  const verifier = base64url(randomBytes(32));
  const nonce = base64url(randomBytes(18));
  const url = new URL(metadata.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", options.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", base64url(createHash("sha256").update(verifier).digest()));
  url.searchParams.set("code_challenge_method", "S256");
  return { url: url.toString(), verifier, nonce };
}

type ClientAuthMethod = "client_secret_basic" | "client_secret_post";

/** How a request to the token endpoint proves it is this client. */
interface ClientCredentials {
  headers: Record<string, string>;
  body: Record<string, string>;
}

/**
 * The ways to send the client secret, in the order to try them. HTTP Basic is
 * the OpenID default; a provider that lists only the POST body gets that.
 * Some providers list both but take only the one the client was registered
 * with (Better Auth does), so the other is the fallback.
 */
function clientAuthMethods(metadata: ProviderMetadata): ClientAuthMethod[] {
  const listed = metadata.token_endpoint_auth_methods_supported;
  const post = listed?.includes("client_secret_post") ?? false;
  if (post && !listed?.includes("client_secret_basic")) return ["client_secret_post"];
  return post ? ["client_secret_basic", "client_secret_post"] : ["client_secret_basic"];
}

function clientCredentials(
  method: ClientAuthMethod,
  options: OidcSignInOptions,
): ClientCredentials {
  if (method === "client_secret_post") {
    return {
      headers: {},
      body: { client_id: options.clientId, client_secret: options.clientSecret },
    };
  }
  const pair = `${encodeURIComponent(options.clientId)}:${encodeURIComponent(options.clientSecret)}`;
  return { headers: { authorization: `Basic ${Buffer.from(pair).toString("base64")}` }, body: {} };
}

interface TokenResponse {
  id_token?: string;
  access_token?: string;
  error?: string;
}

/**
 * Trade the code for tokens. A provider that refuses the client's credentials
 * (invalid_client) has not used the code up, so the next way of sending them
 * gets a turn; any other refusal is final.
 */
async function exchangeCode(
  metadata: ProviderMetadata,
  options: OidcSignInOptions,
  input: { code: string; redirectUri: string; verifier: string },
): Promise<TokenResponse> {
  const doFetch = options.fetch ?? fetch;
  let refusal = "";
  for (const method of clientAuthMethods(metadata)) {
    const credentials = clientCredentials(method, options);
    const response = await doFetch(metadata.token_endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
        ...credentials.headers,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: input.code,
        redirect_uri: input.redirectUri,
        code_verifier: input.verifier,
        ...credentials.body,
      }),
    });
    // SAFETY: only the fields read below are used, and each is checked for a string.
    const tokens = (await response.json().catch(() => ({}))) as TokenResponse;
    if (response.ok && typeof tokens.id_token === "string") return tokens;
    refusal = `${metadata.token_endpoint} answered ${response.status}${tokens.error ? ` (${tokens.error})` : ""} with no ID token`;
    if (tokens.error !== "invalid_client") break;
  }
  throw new Error(refusal);
}

async function verifyIdToken(
  idToken: string,
  metadata: ProviderMetadata,
  options: OidcSignInOptions,
  nonce: string,
): Promise<JWTPayload> {
  const checks = {
    issuer: [metadata.issuer, ...(options.issuerAliases ?? [])],
    audience: options.clientId,
    requiredClaims: ["sub", "exp", "iat"],
  };
  // An HMAC-signed ID token is keyed with the client secret, which only
  // Studio and the provider hold. Anything else is checked against the keys
  // the provider publishes.
  const { alg } = decodeProtectedHeader(idToken);
  let payload: JWTPayload;
  if (alg?.startsWith("HS")) {
    ({ payload } = await jwtVerify(
      idToken,
      new TextEncoder().encode(options.clientSecret),
      checks,
    ));
  } else {
    if (!metadata.jwks_uri) {
      throw new Error(`the ID token is signed with ${alg}, and the provider publishes no jwks_uri`);
    }
    const response = await (options.fetch ?? fetch)(metadata.jwks_uri, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error(`${metadata.jwks_uri} answered ${response.status}`);
    // SAFETY: createLocalJWKSet validates the set's shape and throws on a bad one.
    const keys = createLocalJWKSet((await response.json()) as JSONWebKeySet);
    ({ payload } = await jwtVerify(idToken, keys, checks));
  }
  if (payload.nonce !== nonce) throw new Error("the ID token's nonce isn't this sign-in's");
  if (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== options.clientId) {
    throw new Error("the ID token was issued to another client");
  }
  return payload;
}

function claimString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function claimVerified(payload: Record<string, unknown>): boolean {
  // Some providers send the string "true".
  return payload.email_verified === true || payload.email_verified === "true";
}

/** Trade the code for tokens, check the ID token, and say who signed in. */
export async function finishOidcSignIn(
  options: OidcSignInOptions,
  input: { code: string; redirectUri: string; verifier: string; nonce: string },
): Promise<OidcPerson> {
  const doFetch = options.fetch ?? fetch;
  const metadata = await discover(options);
  const tokens = await exchangeCode(metadata, options, input);
  const claims: Record<string, unknown> = await verifyIdToken(
    tokens.id_token ?? "",
    metadata,
    options,
    input.nonce,
  );
  const sub = String(claims.sub);

  // Some providers keep the email out of the ID token and in userinfo.
  if (!claimString(claims, "email") && metadata.userinfo_endpoint && tokens.access_token) {
    const response = await doFetch(metadata.userinfo_endpoint, {
      headers: { accept: "application/json", authorization: `Bearer ${tokens.access_token}` },
    });
    // SAFETY: every claim read from it is type-checked by claimString or claimVerified.
    const info = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    // Userinfo about someone else is ignored, as the spec requires.
    if (response.ok && info.sub === sub) Object.assign(claims, { ...info, sub });
  }

  const email = claimString(claims, "email");
  const name = claimString(claims, "name") ?? claimString(claims, "preferred_username");
  return {
    sub,
    ...(email ? { email } : {}),
    emailVerified: claimVerified(claims),
    ...(name ? { name } : {}),
  };
}
