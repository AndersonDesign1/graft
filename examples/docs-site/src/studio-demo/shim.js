/**
 * Studio, with nothing behind it.
 *
 * The landing previews embed the real Studio bundle (`packages/studio/dist/ui`)
 * in an iframe. A static site has no Studio API, so this script answers
 * `/api/studio/v1/*` from responses recorded against a real `graft studio`
 * running on this site's own content. It loads before the app's module.
 *
 * Reads are replayed. A field edit (`PUT /entry`) is kept in memory, so the
 * entry reads back changed and shows as a draft until the frame reloads.
 * Everything else that writes is refused with a GraftError-shaped body, so
 * Studio prints the reason and the fix the way it prints any other.
 */
(() => {
  const API = "/api/studio/v1";
  const THEME_KEY = "graft-studio-theme";

  // The page that embeds the frame says which scheme it is in.
  const theme = new URLSearchParams(location.search).get("theme");
  if (theme === "light" || theme === "dark") {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* private mode: Studio follows the system scheme instead */
    }
    document.documentElement.dataset.theme = theme;
  }
  addEventListener("message", (event) => {
    if (event.origin !== location.origin) return;
    const next = event.data?.graftStudioTheme;
    if (next !== "light" && next !== "dark") return;
    document.documentElement.dataset.theme = next;
  });

  // Studio focuses a field and scrolls the open row into view when an entry
  // loads. Inside a frame both would also scroll the page that embeds it, so
  // a visitor reading the landing page would be thrown down to the frame.
  // Keep both inside this document.
  if (window.parent !== window) {
    const focus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function (options) {
      focus.call(this, { ...options, preventScroll: true });
    };
    Element.prototype.scrollIntoView = function () {
      for (let box = this.parentElement; box; box = box.parentElement) {
        const overflow = getComputedStyle(box).overflowY;
        if (box.scrollHeight <= box.clientHeight) continue;
        if (overflow !== "auto" && overflow !== "scroll") continue;
        const target = this.getBoundingClientRect();
        const view = box.getBoundingClientRect();
        if (target.top < view.top) box.scrollTop -= view.top - target.top;
        else if (target.bottom > view.bottom) box.scrollTop += target.bottom - view.bottom;
        return;
      }
    };
  }

  const realFetch = window.fetch.bind(window);
  const fixtures = realFetch(new URL("./demo-fixtures.json", location.href)).then((res) =>
    res.json(),
  );

  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  /** The fixture key for a request: its path under the API, params sorted, no branch. */
  const keyOf = (url) => {
    const params = new URLSearchParams(url.search);
    params.delete("branch");
    params.sort();
    const query = params.toString();
    return url.pathname.slice(API.length) + (query ? `?${query}` : "");
  };

  const refuse = () =>
    json(
      {
        error: "DEMO_READ_ONLY",
        message: "This Studio is a demo with no project behind it.",
        fix: "Run npx @usegraft/cli@latest init in your repo, then graft studio.",
      },
      403,
    );

  async function saveEntry(init) {
    const data = await fixtures;
    const request = JSON.parse(init?.body ?? "{}");
    const key = `/entry?collection=${request.collection}&slug=${request.slug}`;
    const entry = data[key];
    if (!entry) return refuse();
    if (request.data) entry.data = request.data;
    if (typeof request.body === "string") entry.body = request.body;
    entry.status = "changed";
    const drafts = data["/drafts"];
    if (drafts && !drafts.changes.some((change) => change.path === entry.path)) {
      drafts.changes.push({
        path: entry.path,
        collection: entry.collection,
        slug: entry.slug,
        title: entry.data?.title ?? entry.slug,
        kind: "modified",
        conflict: false,
      });
    }
    return json({
      collection: entry.collection,
      slug: entry.slug,
      path: entry.path,
      version: entry.version,
      status: "changed",
    });
  }

  window.fetch = async (input, init) => {
    const href = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    const url = new URL(href, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith(`${API}/`)) {
      return realFetch(input, init);
    }
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "PUT" && url.pathname === `${API}/entry`) return saveEntry(init);
    if (method !== "GET") return refuse();
    const data = await fixtures;
    const hit = data[keyOf(url)];
    if (hit !== undefined) return json(hit);
    return json(
      {
        error: "DEMO_NOT_RECORDED",
        message: "This screen is not part of the demo.",
        fix: "Run graft studio on your own project to see it.",
      },
      404,
    );
  };
})();
