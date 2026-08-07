import { useState } from "react";
import type { ContentTree } from "../../types";
import {
  IconCheck,
  IconConnection,
  IconCopy,
  IconDatabase,
  IconExternal,
  IconFile,
  IconInfo,
  IconKeyboard,
  IconMoon,
  IconPalette,
  IconStack,
  IconSun,
  IconSystem,
  type IconComponent,
} from "../components/icons";
import { IdentityMark, Pill } from "../components/primitives";
import { Switch } from "../components/ui/field";
import type { Theme } from "../lib/theme";
import { plural } from "../lib/format";

const THEMES: Array<{ id: Theme; label: string; hint: string; Icon: IconComponent }> = [
  { id: "system", label: "System", hint: "Follow the OS setting", Icon: IconSystem },
  { id: "light", label: "Light", hint: "Ivory paper, warm ink", Icon: IconSun },
  { id: "dark", label: "Dark", hint: "Black stage, off-white type", Icon: IconMoon },
];

const SHORTCUTS: Array<[string[], string]> = [
  [["⌘", "K"], "Open the command palette"],
  [["⌘", "S"], "Save the open document"],
  [["↑", "↓"], "Move through palette results"],
  [["Enter"], "Run the selected command"],
  [["Esc"], "Close the palette or a dialog"],
];

function Section({
  title,
  description,
  Icon,
  children,
}: {
  title: string;
  description: string;
  Icon: IconComponent;
  children: React.ReactNode;
}) {
  return (
    <section className="card settings-card">
      <div className="card-head">
        <div className="card-head-title">
          <span className="settings-icon">
            <Icon size={15} />
          </span>
          <div>
            <h2 className="card-title">{title}</h2>
            <p className="card-sub">{description}</p>
          </div>
        </div>
      </div>
      {children}
    </section>
  );
}

function CopyRow({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="fact-copy">
      <code>{value}</code>
      <button
        type="button"
        className="copy"
        aria-label="Copy"
        onClick={() => {
          void navigator.clipboard?.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        }}
      >
        {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
        {copied ? "Copied" : "Copy"}
      </button>
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
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  );
  const loopback = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
  const fileCollections = tree?.collections.filter((c) => c.authority === "file") ?? [];
  const dbCollections = tree?.collections.filter((c) => c.authority === "db") ?? [];

  return (
    // A centred column, not a grid. Settings cards have wildly different
    // heights, and auto-fit packing made the page look ragged and unfinished;
    // one column reads as deliberate and keeps every label on the same axis.
    <div className="view view-narrow">
      <header className="view-head">
        <div>
          <h1 className="view-title">Settings</h1>
          <p className="view-sub">
            Preferences are local to this browser. Everything else is what the running server told
            us.
          </p>
        </div>
      </header>

      <div className="settings-stack">
        <Section
          title="Appearance"
          description="Both schemes are first-class — the tokens are built on light-dark()."
          Icon={IconPalette}
        >
          <div className="choices">
            {THEMES.map((option) => (
              <button
                key={option.id}
                type="button"
                className="choice"
                data-active={theme === option.id}
                data-scheme={option.id}
                onClick={() => setTheme(option.id)}
              >
                {/* A swatch beats a description: you pick a theme by looking
                    at it, not by reading about it. */}
                <span className="choice-preview" aria-hidden="true">
                  <span className="choice-preview-bar" />
                  <span className="choice-preview-line" />
                  <span className="choice-preview-line" data-short="" />
                </span>
                <span className="choice-row">
                  <option.Icon size={14} />
                  <span className="choice-label">{option.label}</span>
                  {theme === option.id ? <IconCheck size={13} className="choice-check" /> : null}
                </span>
                <span className="choice-hint">{option.hint}</span>
              </button>
            ))}
          </div>
          <div className="setting-row">
            <div>
              <p className="setting-row-label">Reduce motion</p>
              <p className="setting-row-hint">
                Follows your OS setting. Transitions shorten; nothing moves on scroll.
              </p>
            </div>
            <Switch
              checked={reducedMotion}
              onCheckedChange={setReducedMotion}
              disabled
              aria-label="Reduce motion (follows the system setting)"
            />
          </div>
        </Section>

        <Section
          title="Workspace"
          description="What this Studio window is pointed at."
          Icon={IconConnection}
        >
          <dl className="facts">
            <div>
              <dt>Branch</dt>
              <dd>
                <code>{branch}</code>
              </dd>
            </div>
            <div>
              <dt>Origin</dt>
              <dd>
                <CopyRow value={window.location.origin} />
              </dd>
            </div>
            <div>
              <dt>Access</dt>
              <dd>
                {loopback ? (
                  <>
                    <Pill tone="ready">loopback</Pill>{" "}
                    <span className="muted">no token required</span>
                  </>
                ) : (
                  <>
                    <Pill tone="pending">remote</Pill>{" "}
                    <span className="muted">bearer token required</span>
                  </>
                )}
              </dd>
            </div>
            <div>
              <dt>API</dt>
              <dd>
                <a
                  className="fact-link"
                  href="/api/studio/v1/openapi.json"
                  target="_blank"
                  rel="noreferrer"
                >
                  openapi.json
                  <IconExternal size={12} />
                </a>
              </dd>
            </div>
          </dl>
        </Section>

        <Section
          title="Content"
          description="Collections this project registers, and where each one lives."
          Icon={IconStack}
        >
          {tree ? (
            <>
              <dl className="facts">
                <div>
                  <dt>Documents</dt>
                  <dd data-numeric="">
                    {plural(tree.summary.documents, "document")} · {tree.summary.synced} in sync
                    {tree.summary.drift > 0 ? ` · ${tree.summary.drift} out of sync` : ""}
                  </dd>
                </div>
              </dl>
              <ul className="settings-list">
                {fileCollections.map((collection) => (
                  <li key={collection.name}>
                    <IdentityMark name={collection.name} size="sm" />
                    <span className="settings-list-name">{collection.name}</span>
                    <span className="settings-list-meta">
                      <IconFile size={12} />
                      content/{collection.name}/
                    </span>
                    <span className="count" data-numeric="">
                      {collection.documents.length}
                    </span>
                  </li>
                ))}
                {dbCollections.map((collection) => (
                  <li key={collection.name}>
                    <IdentityMark name={collection.name} size="sm" />
                    <span className="settings-list-name">{collection.name}</span>
                    <span className="settings-list-meta">
                      <IconDatabase size={12} />
                      data_records
                    </span>
                    <Pill tone="db">db</Pill>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="muted">Loading the content tree…</p>
          )}
        </Section>

        <Section
          title="Keyboard"
          description="Everything the Studio listens for."
          Icon={IconKeyboard}
        >
          <dl className="facts facts-keys">
            {SHORTCUTS.map(([keys, description]) => (
              <div key={description}>
                <dt>
                  {keys.map((key) => (
                    <kbd key={key}>{key}</kbd>
                  ))}
                </dt>
                <dd>{description}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section
          title="About"
          description="Studio is opt-in — nothing here runs unless you asked for it."
          Icon={IconInfo}
        >
          <dl className="facts">
            <div>
              <dt>Package</dt>
              <dd>
                <code>@graft/studio</code>
              </dd>
            </div>
            <div>
              <dt>Parity</dt>
              <dd>
                Every action here is also available through MCP and the CLI — the UI is a client of
                the same HTTP surface, never a privileged path.
              </dd>
            </div>
            <div>
              <dt>Source of truth</dt>
              <dd>
                Git owns the MDX. The Postgres index is a projection that <code>compile</code>{" "}
                refreshes.
              </dd>
            </div>
          </dl>
        </Section>
      </div>
    </div>
  );
}
