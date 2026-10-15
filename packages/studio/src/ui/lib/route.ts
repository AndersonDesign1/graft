import { useCallback, useEffect, useState } from "react";

/**
 * Where the editor is. Content comes first in the URL (`#/c/products/hat`);
 * the developer views live one level down (`#/dev/history`) because a content
 * team rarely needs them and should never land on them by default.
 */
export type ViewId =
  | "home"
  | "inbox"
  | "media"
  | "collection"
  | "entry"
  | "overview"
  | "schema"
  | "branches"
  | "history"
  | "settings"
  | "agents";

export const DEV_VIEWS = [
  "overview",
  "schema",
  "branches",
  "history",
  "settings",
  "agents",
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
  const path = hash.split("?")[0] ?? "";
  const parts = path.replace(/^#\/?/, "").split("/").filter(Boolean).map(safeDecode);
  const [head, a, b] = parts;
  if (head === "c" && a) {
    return b ? { view: "entry", collection: a, slug: b } : { view: "collection", collection: a };
  }
  if (head === "inbox") return { view: "inbox" };
  if (head === "media") return { view: "media" };
  // Approvals moved into the inbox, with review requests.
  if ((head === "dev" && a === "approvals") || head === "approvals") return { view: "inbox" };
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
    case "inbox":
      return "#/inbox";
    case "media":
      return "#/media";
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

/**
 * A list's search, filter and sort, after `?` in the hash
 * (`#/c/projects?q=react&status=unpublished`), so a reload, the back button
 * and a shared link come back to the same rows. Defaults are left out.
 */
export interface ListState {
  q: string;
  status: "all" | "unpublished" | "published";
  where: Record<string, string>;
  sort: { key: string; dir: "asc" | "desc" };
}

const STATUSES: readonly ListState["status"][] = ["all", "unpublished", "published"];

export function listStateFromHash(hash: string): ListState {
  const at = hash.indexOf("?");
  const params = new URLSearchParams(at === -1 ? "" : hash.slice(at + 1));
  const status = params.get("status") ?? "all";
  const where: Record<string, string> = {};
  for (const [key, value] of params) {
    if (key.startsWith("where.") && key.length > 6) where[key.slice(6)] = value;
  }
  return {
    q: params.get("q") ?? "",
    status: STATUSES.find((known) => known === status) ?? "all",
    where,
    sort: {
      key: params.get("sort") || "site",
      dir: params.get("dir") === "desc" ? "desc" : "asc",
    },
  };
}

export function listStateToHash(path: string, state: ListState): string {
  const params = new URLSearchParams();
  if (state.q) params.set("q", state.q);
  if (state.status !== "all") params.set("status", state.status);
  for (const [field, value] of Object.entries(state.where)) params.set(`where.${field}`, value);
  if (state.sort.key !== "site") params.set("sort", state.sort.key);
  if (state.sort.dir !== "asc") params.set("dir", state.sort.dir);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

/** Record a list's state in the address without a new history entry. */
export function replaceListState(state: ListState): void {
  const path = window.location.hash.split("?")[0] || "#/";
  const next = listStateToHash(path, state);
  if (next === window.location.hash) return;
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${window.location.search}${next}`,
  );
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
