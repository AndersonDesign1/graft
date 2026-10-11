import { useCallback, useEffect, useState } from "react";

/**
 * Where the editor is. Content comes first in the URL (`#/c/products/hat`);
 * the developer views live one level down (`#/dev/history`) because a content
 * team rarely needs them and should never land on them by default.
 */
export type ViewId =
  | "home"
  | "collection"
  | "entry"
  | "overview"
  | "schema"
  | "approvals"
  | "branches"
  | "history"
  | "settings";

export const DEV_VIEWS = [
  "overview",
  "schema",
  "approvals",
  "branches",
  "history",
  "settings",
] as const;
export type DevView = (typeof DEV_VIEWS)[number];

export interface Route {
  view: ViewId;
  collection?: string;
  slug?: string;
}

/**
 * `decodeURIComponent` throws URIError on malformed escapes ("%", "%ZZ", "%FF",
 * lone surrogates). parseHash runs inside useRoute's useState initialiser, so
 * that throw happened during the first render and white-screened the whole
 * Studio, from a link anyone could send. A segment we cannot decode is far
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
  const [head, a, b] = parts;
  if (head === "c" && a) {
    return b ? { view: "entry", collection: a, slug: b } : { view: "collection", collection: a };
  }
  if (head === "dev" && a && (DEV_VIEWS as readonly string[]).includes(a)) {
    return { view: a as DevView };
  }
  // Links from before content moved to `#/c/`, still in bookmarks and chats.
  if (head === "collections" && a) {
    return b ? { view: "entry", collection: a, slug: b } : { view: "collection", collection: a };
  }
  if (head && (DEV_VIEWS as readonly string[]).includes(head)) return { view: head as DevView };
  return { view: "home" };
}

export function toHash(route: Route): string {
  const enc = encodeURIComponent;
  switch (route.view) {
    case "home":
      return "#/";
    case "collection":
      return `#/c/${enc(route.collection ?? "")}`;
    case "entry":
      return `#/c/${enc(route.collection ?? "")}/${enc(route.slug ?? "")}`;
    default:
      return `#/dev/${route.view}`;
  }
}

/**
 * Hash routing, no dependency. It survives reload, restores the back button,
 * and gives the command palette somewhere to navigate to.
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

/** Branch lives in the query string, not the hash: it scopes everything. */
export function currentBranch(fallback = "main"): string {
  return new URLSearchParams(window.location.search).get("branch")?.trim() || fallback;
}

export function setBranchInUrl(branch: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set("branch", branch);
  window.history.replaceState(null, "", url.toString());
}
