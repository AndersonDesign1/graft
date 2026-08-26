import { useCallback, useEffect, useState } from "react";

export type ViewId =
  | "overview"
  | "collections"
  | "schema"
  | "approvals"
  | "branches"
  | "history"
  | "settings";

const VIEWS: ViewId[] = [
  "overview",
  "collections",
  "schema",
  "approvals",
  "branches",
  "history",
  "settings",
];

export interface Route {
  view: ViewId;
  /** Selected collection, when the view is `collections`. */
  collection?: string;
  /** Selected document slug within that collection. */
  slug?: string;
}

/** `#/collections/docs/getting-started` */
/**
 * `decodeURIComponent` throws URIError on malformed escapes ("%", "%ZZ", "%FF",
 * lone surrogates). parseHash runs inside useRoute's useState initialiser, so
 * that throw happened during the first render and white-screened the whole
 * Studio — from a link anyone could send. A segment we cannot decode is far
 * better shown as-is than not shown at all.
 */
function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(safeDecode);
  const view = parts[0] as ViewId | undefined;
  if (!view || !VIEWS.includes(view)) return { view: "overview" };
  return {
    view,
    ...(parts[1] ? { collection: parts[1] } : {}),
    ...(parts[2] ? { slug: parts[2] } : {}),
  };
}

export function toHash(route: Route): string {
  const parts = [route.view, route.collection, route.slug]
    .filter((p): p is string => Boolean(p))
    .map(encodeURIComponent);
  return `#/${parts.join("/")}`;
}

/**
 * Hash routing, no dependency. Worth having over a `useState` switch: it
 * survives reload, restores the back button, and gives the command palette
 * somewhere to navigate to.
 */
export function useRoute(): [Route, (next: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onChange = (): void => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const navigate = useCallback((next: Route) => {
    const hash = toHash(next);
    if (window.location.hash === hash) return;
    window.location.hash = hash;
  }, []);

  return [route, navigate];
}

/** Branch lives in the query string, not the hash — it scopes everything. */
export function currentBranch(fallback = "main"): string {
  return new URLSearchParams(window.location.search).get("branch")?.trim() || fallback;
}

export function setBranchInUrl(branch: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set("branch", branch);
  window.history.replaceState(null, "", url.toString());
}
