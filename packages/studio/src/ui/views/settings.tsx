import type { Theme } from "../lib/theme";

const THEMES: Array<{ id: Theme; label: string; hint: string }> = [
  { id: "system", label: "System", hint: "Follow the OS setting" },
  { id: "light", label: "Light", hint: "Ivory paper, warm ink" },
  { id: "dark", label: "Dark", hint: "Black stage, off-white type" },
];

export function SettingsView({
  branch,
  theme,
  setTheme,
}: {
  branch: string;
  theme: Theme;
  setTheme: (next: Theme) => void;
}) {
  return (
    <div className="view">
      <header className="view-head">
        <div>
          <h1 className="view-title">Settings</h1>
          <p className="view-sub">Local to this Studio window.</p>
        </div>
      </header>

      <div className="stack">
        <section className="card">
          <div className="card-head">
            <div>
              <h2 className="card-title">Appearance</h2>
              <p className="card-sub">
                Both schemes are first-class — the tokens are built on <code>light-dark()</code>.
              </p>
            </div>
          </div>
          <div className="choices">
            {THEMES.map((option) => (
              <button
                key={option.id}
                type="button"
                className="choice"
                data-active={theme === option.id}
                onClick={() => setTheme(option.id)}
              >
                <span className="choice-label">{option.label}</span>
                <span className="choice-hint">{option.hint}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h2 className="card-title">This session</h2>
              <p className="card-sub">Where the Studio is pointed and how it authenticates.</p>
            </div>
          </div>
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
                <code>{window.location.origin}</code>
              </dd>
            </div>
            <div>
              <dt>Auth</dt>
              <dd>
                {/^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname)
                  ? "Loopback — no token required"
                  : "Non-loopback — bearer token required"}
              </dd>
            </div>
            <div>
              <dt>API</dt>
              <dd>
                <a href="/api/studio/v1/openapi.json" target="_blank" rel="noreferrer">
                  openapi.json
                </a>
              </dd>
            </div>
          </dl>
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h2 className="card-title">Keyboard</h2>
              <p className="card-sub">Everything the Studio listens for.</p>
            </div>
          </div>
          <dl className="facts">
            <div>
              <dt>
                <kbd>⌘</kbd> <kbd>K</kbd>
              </dt>
              <dd>Open the command palette</dd>
            </div>
            <div>
              <dt>
                <kbd>⌘</kbd> <kbd>S</kbd>
              </dt>
              <dd>Save the open document</dd>
            </div>
            <div>
              <dt>
                <kbd>Esc</kbd>
              </dt>
              <dd>Close the palette</dd>
            </div>
          </dl>
        </section>
      </div>
    </div>
  );
}
