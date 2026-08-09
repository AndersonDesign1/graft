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
import { useEffect, useRef, useState } from "react";
import type { ContentTree } from "../../types";
import {
  IconCheck,
  IconCopy,
  IconDatabase,
  IconExternal,
  IconFile,
  IconMoon,
  IconSun,
  IconSystem,
  type IconComponent,
} from "../components/icons";
import { IdentityMark, Pill } from "../components/primitives";
import { ListSkeleton } from "../components/skeletons";
import type { Theme } from "../lib/theme";
import { plural } from "../lib/format";

const THEMES: Array<{ id: Theme; label: string; Icon: IconComponent }> = [
  { id: "system", label: "System", Icon: IconSystem },
  { id: "light", label: "Light", Icon: IconSun },
  { id: "dark", label: "Dark", Icon: IconMoon },
];

const SHORTCUTS: Array<[string[], string]> = [
  [["⌘", "K"], "Open the command palette"],
  [["⌘", "S"], "Save the open document"],
  [["↑", "↓"], "Move through palette results"],
  [["Enter"], "Run the selected command"],
  [["Esc"], "Close the palette or a dialog"],
];

const SECTIONS = [
  {
    id: "appearance",
    title: "Appearance",
    sub: "Both schemes are first-class — the tokens are built on light-dark(). Stored in this browser.",
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
    sub: "Studio is opt-in — nothing here runs unless you asked for it.",
  },
] as const satisfies ReadonlyArray<{ id: string; title: string; sub: string }>;

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

function Section({
  id,
  title,
  sub,
  children,
}: {
  id: string;
  title: string;
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <section className="set-section" id={id}>
      <div>
        <h2 className="set-section-title">{title}</h2>
        <p className="set-section-sub">{sub}</p>
      </div>
      {children}
    </section>
  );
}

function Row({
  label,
  hint,
  children,
  stack = false,
}: {
  label: string;
  hint?: string;
  children?: React.ReactNode;
  stack?: boolean;
}) {
  return (
    <div className="set-row" data-stack={stack}>
      <div>
        <p className="set-row-label">{label}</p>
        {hint ? <p className="set-row-hint">{hint}</p> : null}
      </div>
      {children ? <div className="set-row-control">{children}</div> : null}
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number>(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      className="set-copy"
      data-copied={copied}
      aria-label={copied ? "Copied" : `Copy ${value}`}
      onClick={() => {
        void navigator.clipboard?.writeText(value);
        setCopied(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 1600);
      }}
    >
      {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
    </button>
  );
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
  const idsRef = useRef(SECTIONS.map((s) => s.id));
  const current = useCurrentSection(idsRef.current);

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
                          <IconCheck size={13} className="theme-choice-check" />
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
                    : "Bound beyond loopback — every request must carry a bearer token."
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
                  <IconExternal size={12} />
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
                        <IdentityMark name={collection.name} size="sm" />
                        <span className="set-collection-name">{collection.name}</span>
                        <span className="set-collection-where">
                          <IconFile size={12} />
                          content/{collection.name}/
                        </span>
                        <span className="set-collection-count" data-numeric="">
                          {collection.documents.length}
                        </span>
                      </li>
                    ))}
                    {dbCollections.map((collection) => (
                      <li key={collection.name}>
                        <IdentityMark name={collection.name} size="sm" />
                        <span className="set-collection-name">{collection.name}</span>
                        <span className="set-collection-where">
                          <IconDatabase size={12} />
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
                <code className="set-value">@graft/studio</code>
              </Row>
              <Row
                label="Parity"
                hint="Every action here is also available through MCP and the CLI — the UI is a client of the same HTTP surface, never a privileged path."
              />
              <Row
                label="Source of truth"
                hint="Git owns the MDX. The Postgres index is a projection that compile refreshes."
              />
            </div>
          </Section>
        </div>

        {/* Buttons, not anchors: the Studio routes on the hash, so an
            `href="#appearance"` would parse as an unknown view and throw the
            operator back to Overview. */}
        <nav className="settings-index" aria-label="Settings sections">
          {SECTIONS.map((section) => (
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
