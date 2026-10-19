/**
 * Settings.
 *
 * Sections, not a stack of equal cards: each one is a heading plus a single
 * panel of hairline-divided rows, with a sticky index tracking position. The
 * first pass gave "which theme am I on" and "what package is this" identical
 * card chrome at identical size, which is what made it read as a debug dump.
 *
 * Everything below the Appearance section is a *readout* — what the running
 * server told us. Only the theme is a preference, and it is the only control
 * on the page that changes anything.
 */
import { useEffect, useMemo, useState } from "react";
import type { SiteDto } from "../../editor-types";
import type { ContentTree } from "../../types";
import {
  IconCheck,
  IconDatabase,
  IconExternal,
  IconFile,
  IconMoon,
  IconSun,
  IconSystem,
  type IconComponent,
} from "../components/icons";
import { CollectionMark } from "../components/collection-icon";
import { CopyButton, Row, Section } from "../components/set-row";
import { useStudio } from "../lib/studio";
import { AccountPanel, PeoplePanel } from "./people";
import { HooksPanel, SitePanel } from "./site";
import { NeedsDatabase, Pill } from "../components/primitives";
import { ListSkeleton } from "../components/skeletons";
import type { Theme } from "../lib/theme";
import { useResource } from "../lib/use-resource";
import { plural } from "../lib/format";
import { MOD_KEY } from "../lib/keys";

const THEMES: Array<{ id: Theme; label: string; Icon: IconComponent }> = [
  { id: "system", label: "System", Icon: IconSystem },
  { id: "light", label: "Light", Icon: IconSun },
  { id: "dark", label: "Dark", Icon: IconMoon },
];

const SHORTCUTS: Array<[string[], string]> = [
  [[MOD_KEY, "K"], "Open the command palette"],
  [[MOD_KEY, "S"], "Save the open document"],
  [[MOD_KEY, "\\"], "Show or hide an entry's details"],
  [["J", "K"], "Move down or up a list of entries"],
  [["↑", "↓", "Home", "End"], "Move through a list once you are in it"],
  [["↑", "↓"], "Move through palette results"],
  [["Enter"], "Open the selected entry, or run the selected command"],
  [["Esc"], "Close the palette or a dialog"],
];

const SECTIONS = [
  {
    id: "appearance",
    title: "Appearance",
    sub: "Light and dark are both first-class. Your choice is stored in this browser.",
  },
  {
    id: "account",
    title: "Account",
    sub: "Who you're signed in as.",
  },
  {
    id: "people",
    title: "People",
    sub: "Who can sign in to this Studio, and what each person can do.",
  },
  {
    id: "site",
    title: "Site",
    sub: "The site's name and where it is online.",
  },
  {
    id: "hooks",
    title: "Deploy hooks",
    sub: "URLs called after every publish, so the site rebuilds or refreshes what it cached.",
  },
  {
    id: "workspace",
    title: "Workspace",
    sub: "What this Studio window is pointed at.",
  },
  {
    id: "content",
    title: "Content",
    sub: "Collections this project registers, and where each one lives.",
  },
  {
    id: "keyboard",
    title: "Keyboard",
    sub: "Everything the Studio listens for.",
  },
  {
    id: "about",
    title: "About",
    sub: "Studio is opt-in: nothing here runs unless you asked for it.",
  },
] as const satisfies ReadonlyArray<{ id: string; title: string; sub: string }>;

/**
 * When the hooks are called, for where this Studio saves. A commit on this
 * computer reaches no site, so it calls none: the host builds from the push.
 */
function hooksSub(storage: "local" | "github" | "database" | undefined): string {
  if (storage === "local") {
    return "URLs called when a publish reaches the site: from a hosted Studio, or of content in the database. A commit on this computer calls none; your host builds when you push it.";
  }
  if (storage === "github") {
    return "URLs called after every publish from Studio, so the site rebuilds or refreshes what it cached.";
  }
  return SECTION_BY_ID.hooks.sub;
}

const SECTION_BY_ID = Object.fromEntries(SECTIONS.map((s) => [s.id, s])) as Record<
  (typeof SECTIONS)[number]["id"],
  (typeof SECTIONS)[number]
>;

/**
 * Which section is on screen. Plain scroll position rather than
 * IntersectionObserver: sections have wildly different heights, so "the last
 * heading that passed the top" matches what the reader thinks is current,
 * where intersection ratios do not.
 */
function useCurrentSection(ids: string[]): string {
  const [current, setCurrent] = useState(ids[0] ?? "");
  useEffect(() => {
    const scroller = document.querySelector<HTMLElement>(".view-settings");
    if (!scroller) return;
    let frame = 0;
    const measure = (): void => {
      frame = 0;
      const top = scroller.getBoundingClientRect().top + 80;
      let active = ids[0] ?? "";
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= top) active = id;
      }
      setCurrent(active);
    };
    const onScroll = (): void => {
      if (frame) return;
      frame = window.requestAnimationFrame(measure);
    };
    measure();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [ids]);
  return current;
}

/** A miniature of this Studio in one scheme: rail, sidebar, workspace. */
function ThemePreview({ scheme, half = false }: { scheme: "light" | "dark"; half?: boolean }) {
  return (
    <span className="theme-preview" data-scheme={scheme} data-half={half} aria-hidden="true">
      <span className="tp-rail" />
      <span className="tp-side">
        <span className="tp-line" />
        <span className="tp-line" data-short="true" />
        <span className="tp-line" />
      </span>
      <span className="tp-main">
        <span className="tp-bar" />
        <span className="tp-line" />
        <span className="tp-line" data-short="true" />
      </span>
    </span>
  );
}

export function SettingsView({
  branch,
  theme,
  setTheme,
  tree,
}: {
  branch: string;
  theme: Theme;
  setTheme: (next: Theme) => void;
  tree: ContentTree | null;
}) {
  const prefersReducedMotion =
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const loopback = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
  const fileCollections = tree?.collections.filter((c) => c.authority === "file") ?? [];
  const dbCollections = tree?.collections.filter((c) => c.authority === "db") ?? [];
  const { workspace } = useStudio();
  const accounts = workspace.data?.accounts ?? false;
  const canManagePeople = workspace.data?.user?.scopes.includes("studio:people") ?? false;
  // On this computer there is no sign-in, and the operator runs the site.
  const canManageSite = workspace.data
    ? !workspace.data.user || workspace.data.user.scopes.includes("studio:settings")
    : false;
  const hasDatabase = workspace.data?.database;
  const site = useResource<SiteDto>(canManageSite && hasDatabase ? "/site" : null, [hasDatabase]);
  const database = workspace.data?.storage === "database";
  // Your own account, when you signed in as one rather than with a link.
  const [account, setAccount] = useState<{
    email: string;
    role: string;
    password: boolean;
  } | null>(null);
  useEffect(() => {
    if (!accounts) return;
    fetch("/api/studio/v1/auth/session", { credentials: "same-origin" })
      .then(
        (res) =>
          res.json() as Promise<{
            user: { email: string; role: string; via: string; password: boolean } | null;
          }>,
      )
      .then((body) => setAccount(body.user?.via === "account" ? body.user : null))
      .catch(() => setAccount(null));
  }, [accounts]);
  const sections = useMemo(
    () =>
      SECTIONS.filter(
        (s) =>
          (s.id !== "account" || account !== null) &&
          (s.id !== "people" || (accounts && canManagePeople)) &&
          ((s.id !== "site" && s.id !== "hooks") || canManageSite) &&
          // Without a database, Site says why once; there are no hooks to list.
          (s.id !== "hooks" || hasDatabase !== false),
      ),
    [account, accounts, canManagePeople, canManageSite, hasDatabase],
  );
  const ids = useMemo(() => sections.map((s) => s.id), [sections]);
  const current = useCurrentSection(ids);

  return (
    <div className="view view-settings">
      <header className="view-head">
        <div>
          <h1 className="view-title">Settings</h1>
          <p className="view-sub">
            Preferences are local to this browser. Everything else is what the running server told
            us.
          </p>
        </div>
      </header>

      <div className="settings-layout">
        <div className="settings-sections">
          <Section id="appearance" title="Appearance" sub={SECTION_BY_ID.appearance.sub}>
            <div className="set-panel">
              <Row label="Theme" hint="Applies immediately and persists across sessions." stack>
                <div className="theme-choices">
                  {THEMES.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className="theme-choice"
                      data-active={theme === option.id}
                      onClick={() => setTheme(option.id)}
                      aria-pressed={theme === option.id}
                    >
                      {option.id === "system" ? (
                        <span className="theme-preview-stack">
                          <ThemePreview scheme="light" />
                          <ThemePreview scheme="dark" half />
                        </span>
                      ) : (
                        <ThemePreview scheme={option.id === "light" ? "light" : "dark"} />
                      )}
                      <span className="theme-choice-row">
                        <option.Icon size={14} />
                        <span className="theme-choice-label">{option.label}</span>
                        {theme === option.id ? (
                          <IconCheck size={14} className="theme-choice-check" />
                        ) : null}
                      </span>
                    </button>
                  ))}
                </div>
              </Row>
              {/* A disabled switch reads as broken. Motion follows the OS and
                  the Studio has no override, so state the fact instead of
                  offering a control that refuses every press. */}
              <Row
                label="Reduce motion"
                hint="Follows your system setting. Transitions shorten; nothing moves on scroll."
              >
                <Pill tone={prefersReducedMotion ? "ready" : "neutral"}>
                  {prefersReducedMotion ? "On" : "Off"}
                </Pill>
                <span className="muted">via system</span>
              </Row>
            </div>
          </Section>

          {account ? (
            <Section id="account" title="Account" sub={SECTION_BY_ID.account.sub}>
              <AccountPanel email={account.email} role={account.role} password={account.password} />
            </Section>
          ) : null}

          {accounts && canManagePeople ? (
            <Section id="people" title="People" sub={SECTION_BY_ID.people.sub}>
              <PeoplePanel />
            </Section>
          ) : null}

          {canManageSite && hasDatabase === false ? (
            <Section id="site" title="Site" sub={SECTION_BY_ID.site.sub}>
              <NeedsDatabase
                title="Site settings need a database"
                does="The site's name, its address and the deploy hooks called after a publish are kept in Postgres."
              />
            </Section>
          ) : canManageSite ? (
            <>
              <Section id="site" title="Site" sub={SECTION_BY_ID.site.sub}>
                <SitePanel site={site} />
              </Section>
              <Section id="hooks" title="Deploy hooks" sub={hooksSub(workspace.data?.storage)}>
                <HooksPanel site={site} />
              </Section>
            </>
          ) : null}

          <Section id="workspace" title="Workspace" sub={SECTION_BY_ID.workspace.sub}>
            <div className="set-panel">
              <Row label="Branch" hint="Every read and write on this window is scoped to it.">
                <code className="set-value">{branch}</code>
              </Row>
              <Row label="Origin" hint="The server this Studio is a client of.">
                <code className="set-value">{window.location.origin}</code>
                <CopyButton value={window.location.origin} />
              </Row>
              <Row
                label="Access"
                hint={
                  loopback
                    ? "Loopback binds are trusted; no bearer token is required."
                    : "Bound beyond loopback: every request must carry a bearer token."
                }
              >
                <Pill tone={loopback ? "ready" : "pending"}>
                  {loopback ? "loopback" : "remote"}
                </Pill>
              </Row>
              <Row label="API" hint="The same surface the CLI and MCP tools call.">
                <a
                  className="fact-link"
                  href="/api/studio/v1/openapi.json"
                  target="_blank"
                  rel="noreferrer"
                >
                  openapi.json
                  <IconExternal size={14} />
                </a>
              </Row>
            </div>
          </Section>

          <Section id="content" title="Content" sub={SECTION_BY_ID.content.sub}>
            <div className="set-panel">
              {tree ? (
                <>
                  <Row label="Documents" hint="Counted on disk, compared against the index.">
                    <span data-numeric="">
                      {plural(tree.summary.documents, "document")} · {tree.summary.synced} in sync
                      {tree.summary.drift > 0 ? ` · ${tree.summary.drift} out of sync` : ""}
                    </span>
                  </Row>
                  <ul className="set-collections">
                    {fileCollections.map((collection) => (
                      <li key={collection.name}>
                        <CollectionMark name={collection.name} authority="file" size="sm" />
                        <span className="set-collection-name">{collection.name}</span>
                        <span className="set-collection-where">
                          <IconFile size={14} />
                          content/{collection.name}/
                        </span>
                        <span className="set-collection-count" data-numeric="">
                          {collection.documents.length}
                        </span>
                      </li>
                    ))}
                    {dbCollections.map((collection) => (
                      <li key={collection.name}>
                        <CollectionMark name={collection.name} authority="db" size="sm" />
                        <span className="set-collection-name">{collection.name}</span>
                        <span className="set-collection-where">
                          <IconDatabase size={14} />
                          data_records
                        </span>
                        <span className="set-collection-count">
                          <Pill tone="db">db</Pill>
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <div className="set-row" data-stack="true">
                  <ListSkeleton rows={4} avatar />
                </div>
              )}
            </div>
          </Section>

          <Section id="keyboard" title="Keyboard" sub={SECTION_BY_ID.keyboard.sub}>
            <div className="set-panel">
              {SHORTCUTS.map(([keys, description]) => (
                <Row key={description} label={description}>
                  <span className="set-keys">
                    {keys.map((key) => (
                      <kbd key={key}>{key}</kbd>
                    ))}
                  </span>
                </Row>
              ))}
            </div>
          </Section>

          <Section id="about" title="About" sub={SECTION_BY_ID.about.sub}>
            <div className="set-panel">
              <Row label="Package">
                <code className="set-value">@usegraft/studio</code>
              </Row>
              <Row
                label="Parity"
                hint="Every action here is also available through MCP and the CLI. The UI is a client of the same HTTP surface, never a privileged path."
              />
              <Row
                label="Source of truth"
                hint={
                  database
                    ? "Postgres holds the content. Files are a copy that graft pull writes and graft push sends back."
                    : "Git owns the MDX. The Postgres index is a projection that compile refreshes."
                }
              />
            </div>
          </Section>
        </div>

        {/* Buttons, not anchors: the Studio routes on the hash, so an
            `href="#appearance"` would parse as an unknown view and throw the
            operator back to Overview. */}
        <nav className="settings-index" aria-label="Settings sections">
          {sections.map((section) => (
            <button
              key={section.id}
              type="button"
              data-current={current === section.id}
              onClick={() =>
                document
                  .getElementById(section.id)
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
            >
              {section.title}
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}
