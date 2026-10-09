/**
 * Typed client for the Studio OpenAPI surface. Absolute paths on purpose:
 * the SPA is served both at `/` and under `/studio/`, but the API is always
 * mounted at `/api/studio/v1/*`.
 */
import type { ContentChangeNotice } from "@usegraft/compiler";
import { warnIfNotRefreshed } from "./refresh";

const BASE = "/api/studio/v1";

/** A refused request, with the GraftError fields the UI turns into words. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | undefined,
    readonly fix: string | undefined,
    readonly details: Record<string, unknown> | undefined,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Fired when the API says nobody is signed in, so the shell can ask. */
export const SIGNED_OUT_EVENT = "graft:signed-out";

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "same-origin",
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = (await res.json().catch(() => null)) as
    | (T & {
        message?: string;
        error?: string;
        fix?: string;
        details?: Record<string, unknown>;
      })
    | null;
  if (!res.ok) {
    if (res.status === 401 && body?.message?.includes("requires authentication")) {
      window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
    }
    // GraftError carries an actionable `fix`; surface it, since it is usually
    // more useful to the operator than the message.
    const detail = [body?.message, body?.fix].filter(Boolean).join(" — ");
    throw new ApiError(
      detail || `${res.status} ${res.statusText}`,
      res.status,
      body?.error,
      body?.fix,
      body?.details,
    );
  }
  // Any local write may answer with `refresh`. Warning here, once, covers
  // every save, delete, discard and compile without each caller remembering.
  if (body && typeof body === "object" && "refresh" in body) {
    warnIfNotRefreshed((body as { refresh?: ContentChangeNotice }).refresh);
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

/**
 * What went wrong, for a person. The server's message is written for whoever
 * can act on it (often an agent); here the common cases get plain words, and
 * anything else keeps the server's own message, which is still better than a
 * status code.
 */
export function plainError(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return error instanceof Error && error.message === "Failed to fetch"
      ? "Can't reach Studio. Check your connection; nothing you typed is lost."
      : error instanceof Error
        ? error.message
        : String(error);
  }
  switch (error.code) {
    case "CONTENT_CONFLICT":
      return "Someone else changed this since you opened it.";
    case "SCHEMA_VALIDATION_FAILED":
      return "Some fields need attention before this can be saved.";
    case "SLUG_NOT_UNIQUE":
      return "That URL name is already taken. Choose another.";
    case "INVALID_SLUG":
      return 'URL names use lowercase letters, numbers and hyphens, like "linen-shirt".';
    case "REMOTE_STORE_FAILED":
      return "GitHub refused the change. Your draft is safe; ask whoever set up Studio to check its GitHub access.";
    case "UNAUTHORIZED":
      return error.status === 401 && error.message.includes("scope")
        ? "Your role can't do that. Ask an admin for access."
        : "You're signed out. Sign in again to continue.";
    case "DOCUMENT_NOT_FOUND":
      return "This entry no longer exists. It may have been deleted or renamed.";
    case "GIT_UNAVAILABLE":
      return "This project isn't using git yet, so changes can't be published from here.";
    default:
      return error.message;
  }
}
