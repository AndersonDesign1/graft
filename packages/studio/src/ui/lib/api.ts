/**
 * Typed client for the Studio OpenAPI surface. Absolute paths on purpose:
 * the SPA is served both at `/` and under `/studio/`, but the API is always
 * mounted at `/api/studio/v1/*`.
 */

const BASE = "/api/studio/v1";

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = (await res.json().catch(() => null)) as
    | (T & { message?: string; error?: string; fix?: string })
    | null;
  if (!res.ok) {
    // GraftError carries an actionable `fix`; surface it, since it is usually
    // more useful to the operator than the message.
    const detail = [body?.message, body?.fix].filter(Boolean).join(" — ");
    throw new Error(detail || `${res.status} ${res.statusText}`);
  }
  return body as T;
}

export const qs = (params: Record<string, string | number | undefined>): string => {
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") out.set(key, String(value));
  }
  const s = out.toString();
  return s ? `?${s}` : "";
};
