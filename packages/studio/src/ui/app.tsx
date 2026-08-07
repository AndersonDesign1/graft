import { useCallback, useEffect, useRef, useState } from "react";
import type { BranchList, CompileResultDto, ContentTree } from "../types";
import { CommandPalette } from "./components/palette";
import {
  IconApprovals,
  IconBranches,
  IconChevron,
  IconCollections,
  IconCompile,
  IconHistory,
  IconOverview,
  IconSchema,
  IconSettings,
  IconTheme,
  IconWarning,
} from "./components/icons";
import { api, qs } from "./lib/api";
import { plural } from "./lib/format";
import { currentBranch, setBranchInUrl, useRoute, type ViewId } from "./lib/route";
import { useTheme, type Theme } from "./lib/theme";
import { useResource } from "./lib/use-resource";
import { CollectionsView } from "./views/collections";
import { ApprovalsView, BranchesView, HistoryView } from "./views/operations";
import { OverviewView } from "./views/overview";
import { SchemaView } from "./views/schema";
import { SettingsView } from "./views/settings";

type NavItem = { id: ViewId; label: string; Icon: typeof IconOverview };

const NAV: Array<{ group?: string; items: NavItem[] }> = [
  { items: [{ id: "overview", label: "Overview", Icon: IconOverview }] },
  {
    group: "Content",
    items: [
      { id: "collections", label: "Collections", Icon: IconCollections },
      { id: "schema", label: "Schema", Icon: IconSchema },
    ],
  },
  {
    group: "Operations",
    items: [
      { id: "approvals", label: "Approvals", Icon: IconApprovals },
      { id: "branches", label: "Branches", Icon: IconBranches },
      { id: "history", label: "History", Icon: IconHistory },
    ],
  },
  { items: [{ id: "settings", label: "Settings", Icon: IconSettings }] },
];

const THEME_ORDER: Theme[] = ["system", "light", "dark"];
const THEME_LABEL: Record<Theme, string> = {
  system: "Theme: following the system",
  light: "Theme: light",
  dark: "Theme: dark",
};

export function StudioApp({ branch: initialBranch = "main" }: { branch?: string }) {
  const [branch, setBranch] = useState(() => currentBranch(initialBranch));
  const [route, navigate] = useRoute();
  const [theme, setTheme] = useTheme();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [compileMsg, setCompileMsg] = useState<string | null>(null);
  const [branchMenu, setBranchMenu] = useState(false);
  const branchMenuRef = useRef<HTMLDivElement>(null);

  const tree = useResource<ContentTree>(`/tree${qs({ branch })}`);
  const branches = useResource<BranchList>("/branches");

  const selectBranch = useCallback((name: string) => {
    setBranch(name);
    setBranchInUrl(name);
    setBranchMenu(false);
  }, []);

  const compile = useCallback(async () => {
    setCompiling(true);
    setCompileMsg(null);
    try {
      const result = await api<CompileResultDto>(`/compile${qs({ branch })}`, { method: "POST" });
      setCompileMsg(
        `Compiled ${plural(result.docCount, "document")} · +${result.added} ~${result.changed} −${result.removed}`,
      );
      tree.refresh();
    } catch (err) {
      setCompileMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setCompiling(false);
    }
  }, [branch, tree]);

  // ⌘K anywhere; Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      } else if (e.key === "Escape") {
        setPaletteOpen(false);
        setBranchMenu(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!branchMenu) return;
    const onClick = (e: MouseEvent): void => {
      if (!branchMenuRef.current?.contains(e.target as Node)) setBranchMenu(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [branchMenu]);

  // The compile toast is informational; it should not linger.
  useEffect(() => {
    if (!compileMsg) return;
    const timer = window.setTimeout(() => setCompileMsg(null), 6000);
    return () => window.clearTimeout(timer);
  }, [compileMsg]);

  const drift = tree.data?.summary.drift ?? 0;

  let main: React.ReactNode;
  if (route.view === "collections") {
    main = (
      <CollectionsView
        branch={branch}
        route={route}
        navigate={navigate}
        tree={tree}
        onSaved={tree.refresh}
      />
    );
  } else if (route.view === "schema") main = <SchemaView />;
  else if (route.view === "approvals") main = <ApprovalsView />;
  else if (route.view === "branches") {
    main = (
      <BranchesView
        branch={branch}
        onSelectBranch={(name) => {
          selectBranch(name);
          navigate({ view: "collections" });
        }}
      />
    );
  } else if (route.view === "history") main = <HistoryView branch={branch} />;
  else if (route.view === "settings") {
    main = <SettingsView branch={branch} theme={theme} setTheme={setTheme} />;
  } else {
    main = (
      <OverviewView
        branch={branch}
        tree={tree}
        compiling={compiling}
        onCompile={() => void compile()}
        navigate={navigate}
      />
    );
  }

  return (
    <div className="studio">
      <header className="topbar">
        <div className="topbar-left">
          <span className="brand">
            graft<b>.</b>
          </span>
          <span className="crumb-sep">/</span>
          <span className="scope">studio</span>
          <span className="crumb-sep">/</span>

          {/* Branch is a first-class scope selector, not a label — switching
              re-scopes every view and the URL, so a reload lands in the same
              place. */}
          <div className="branch-select" ref={branchMenuRef}>
            <button
              type="button"
              className="branch-trigger"
              aria-haspopup="listbox"
              aria-expanded={branchMenu}
              onClick={() => setBranchMenu((open) => !open)}
            >
              <span className="dot" data-state="synced" />
              {branch}
              <IconChevron size={12} className="branch-caret" />
            </button>
            {branchMenu ? (
              <div className="menu" role="listbox" aria-label="Switch branch">
                {(branches.data?.branches ?? []).length === 0 ? (
                  <p className="menu-empty">No other branches registered.</p>
                ) : (
                  branches.data?.branches.map((row) => (
                    <button
                      key={row.name}
                      type="button"
                      role="option"
                      aria-selected={row.name === branch}
                      className="menu-item"
                      data-active={row.name === branch}
                      onClick={() => selectBranch(row.name)}
                    >
                      <span className="menu-item-label">{row.name}</span>
                      <span className="menu-item-hint">
                        {row.backend}
                        {row.parent ? ` ← ${row.parent}` : " · root"}
                      </span>
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>
        </div>

        <div className="topbar-right">
          {drift > 0 ? (
            <button
              type="button"
              className="drift"
              onClick={() => void compile()}
              disabled={compiling}
              title="Recompile so the index matches disk"
            >
              <IconWarning size={13} />
              {compiling ? "Compiling…" : `${plural(drift, "change")} to compile`}
            </button>
          ) : null}
          <button
            type="button"
            className="icon-btn"
            onClick={() => setPaletteOpen(true)}
            title="Command palette"
            aria-label="Open command palette"
          >
            <kbd>⌘K</kbd>
          </button>
          <button
            type="button"
            className="icon-btn"
            title={THEME_LABEL[theme]}
            aria-label={THEME_LABEL[theme]}
            data-theme-state={theme}
            onClick={() => setTheme(THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % 3] as Theme)}
          >
            <IconTheme size={15} />
          </button>
        </div>
      </header>

      <div className="body">
        <nav className="rail" aria-label="Studio sections">
          {NAV.map((section, i) => (
            <div className="rail-group" key={section.group ?? `g${i}`}>
              {section.group ? <p className="rail-label">{section.group}</p> : null}
              {section.items.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  className="rail-item"
                  data-active={route.view === id}
                  aria-current={route.view === id ? "page" : undefined}
                  onClick={() => navigate({ view: id })}
                >
                  <Icon size={15} />
                  <span>{label}</span>
                  {id === "approvals" ? <ApprovalCount /> : null}
                  {id === "collections" && drift > 0 ? (
                    <span className="count" data-tone="drifted" data-numeric="">
                      {drift}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <main className="main">{main}</main>
      </div>

      {compileMsg ? (
        <output className="toast" aria-live="polite">
          <IconCompile size={14} />
          {compileMsg}
        </output>
      ) : null}

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        tree={tree.data}
        branches={branches.data}
        navigate={navigate}
        onSelectBranch={selectBranch}
        onCompile={() => void compile()}
      />
    </div>
  );
}

/** Small enough to live here; the rail is the only place it renders. */
function ApprovalCount() {
  const { data } = useResource<{ approvals: unknown[] }>("/approvals");
  const n = data?.approvals.length ?? 0;
  if (n === 0) return null;
  return (
    <span className="count" data-tone="pending" data-numeric="">
      {n}
    </span>
  );
}
