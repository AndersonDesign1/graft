/**
 * Credentials for the GitHub store: a fine-grained token, or a GitHub App.
 *
 * The App is the recommended shape for a team. Its tokens last an hour, its
 * access is exactly the repositories it is installed on, and nothing breaks
 * when the employee who created a personal token leaves. The token is the
 * shortest path for one person self-hosting.
 */
import { createSign } from "node:crypto";
import { GraftError } from "@usegraft/contracts";

export interface GitHubAuth {
  /** A token valid for the next request. */
  token(): Promise<string>;
  readonly kind: "token" | "app";
}

export function tokenAuth(token: string): GitHubAuth {
  return { kind: "token", token: async () => token };
}

export interface AppAuthOptions {
  appId: string;
  /** PEM. Literal `\n` sequences (how most dashboards store a key) are accepted. */
  privateKey: string;
  /** Found from the repository when omitted. */
  installationId?: string;
  /** "owner/name", to find the installation. */
  repo: string;
  apiUrl?: string;
  fetch?: typeof fetch;
  /** Injectable clock, for tests. */
  now?: () => number;
}

const base64url = (input: string | Buffer): string => Buffer.from(input).toString("base64url");

/** The RS256 JWT GitHub accepts as the App's own identity, for ten minutes. */
export function appJwt(appId: string, privateKey: string, nowMs: number): string {
  const now = Math.floor(nowMs / 1000);
  // Backdated a minute for clock drift between this host and GitHub, which
  // GitHub's own documentation recommends.
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  const pem = privateKey.includes("\\n") ? privateKey.replace(/\\n/g, "\n") : privateKey;
  let signature: string;
  try {
    signature = signer.sign(pem, "base64url");
  } catch (error) {
    throw new GraftError({
      code: "CONFIG_INVALID",
      message: "GRAFT_GITHUB_APP_PRIVATE_KEY is not a usable private key.",
      fix: "Paste the full PEM GitHub generated for the App, including the BEGIN and END lines.",
      details: { reason: error instanceof Error ? error.message : String(error) },
    });
  }
  return `${header}.${payload}.${signature}`;
}

/**
 * Installation tokens, minted from the App's JWT and cached until five
 * minutes before they expire. A serverless instance mints one per hour at
 * most rather than one per request.
 */
export function appAuth(options: AppAuthOptions): GitHubAuth {
  const apiUrl = (options.apiUrl ?? "https://api.github.com").replace(/\/+$/, "");
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  let installationId = options.installationId;
  let cached: { token: string; expiresAt: number } | undefined;
  let inflight: Promise<string> | undefined;

  async function call<T>(method: string, path: string): Promise<T> {
    const response = await doFetch(`${apiUrl}${path}`, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${appJwt(options.appId, options.privateKey, now())}`,
        "x-github-api-version": "2022-11-28",
        "user-agent": "graft-studio",
      },
    });
    const body = (await response.json().catch(() => ({}))) as T & { message?: string };
    if (!response.ok) {
      throw new GraftError({
        code: "REMOTE_STORE_FAILED",
        message: `GitHub refused the App's ${method} ${path} (${response.status}): ${body.message ?? ""}`,
        fix:
          response.status === 404
            ? `Install the GitHub App on ${options.repo}, or set GRAFT_GITHUB_APP_INSTALLATION_ID.`
            : "Check GRAFT_GITHUB_APP_ID and GRAFT_GITHUB_APP_PRIVATE_KEY belong to the same App.",
        details: { status: response.status, message: body.message },
      });
    }
    return body;
  }

  async function mint(): Promise<string> {
    if (!installationId) {
      const installation = await call<{ id: number }>("GET", `/repos/${options.repo}/installation`);
      installationId = String(installation.id);
    }
    const minted = await call<{ token: string; expires_at: string }>(
      "POST",
      `/app/installations/${installationId}/access_tokens`,
    );
    cached = { token: minted.token, expiresAt: Date.parse(minted.expires_at) };
    return minted.token;
  }

  return {
    kind: "app",
    async token() {
      if (cached && cached.expiresAt - now() > 5 * 60_000) return cached.token;
      // One mint at a time: a burst of requests on a cold instance shares it.
      inflight ??= mint().finally(() => {
        inflight = undefined;
      });
      return inflight;
    },
  };
}
