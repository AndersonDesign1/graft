import { IconContext } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { BranchList, CompileResultDto, ContentTree } from "../types";
import { CommandPalette } from "./components/palette";
import {
  IconApprovals,
  IconBranches,
  IconCaretUpDown,
  IconCompile,
  IconDatabase,
  IconHistory,
  IconMoon,
  IconOverview,
  IconSchema,
  IconSettings,
  IconSun,
  IconSystem,
  IconWarning,
  type IconComponent,
} from "./components/icons";
import { IdentityMark } from "./components/primitives";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from "./components/ui/menu";
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

type NavItem = { id: ViewId; label: string; Icon: IconComponent };

const TOP: NavItem[] = [{ id: "overview", label: "Overview", Icon: IconOverview }];
const OPERATIONS: NavItem[] = [
  { id: "approvals", label: "Approvals", Icon: IconApprovals },
  { id: "branches", label: "Branches", Icon: IconBranches },
  { id: "history", label: "History", Icon: IconHistory },
];
const BOTTOM: NavItem[] = [
  { id: "schema", label: "Schema", Icon: IconSchema },
  { id: "settings", label: "Settings", Icon: IconSettings },
];

const THEME_ORDER: Theme[] = ["system", "light", "dark"];
const THEME_META: Record<Theme, { label: string; Icon: IconComponent }> = {
  system: { label: "Theme: following the system", Icon: IconSystem },
  light: { label: "Theme: light", Icon: IconSun },
  dark: { label: "Theme: dark", Icon: IconMoon },
};

export function StudioApp({ branch: initialBranch = "main" }: { branch?: string }) {
  const [branch, setBranch] = useState(() => currentBranch(initialBranch));
  const [route, navigate] = useRoute();
  const [theme, setTheme] = useTheme();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [compileMsg, setCompileMsg] = useState<string | null>(null);

  const tree = useResource<ContentTree>(`/tree${qs({ branch })}`);
  const branches = useResource<BranchList>("/branches");
  const approvals = useResource<{ approvals: unknown[] }>("/approvals");

  const selectBranch = useCallback((name: string) => {
    setBranch(name);
    setBranchInUrl(name);
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!compileMsg) return;
    const timer = window.setTimeout(() => setCompileMsg(null), 6000);
    return () => window.clearTimeout(timer);
  }, [compileMsg]);

  const drift = tree.data?.summary.drift ?? 0;
  const pending = approvals.data?.approvals.length ?? 0;
  const collections = useMemo(() => tree.data?.collections ?? [], [tree.data]);
  const themeMeta = THEME_META[theme];

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
  else if (route.view === "approvals") main = <ApprovalsView onDecided={approvals.refresh} />;
  else if (route.view === "branches") {
    main = <BranchesView branch={branch} onSelectBranch={selectBranch} />;
  } else if (route.view === "history") main = <HistoryView branch={branch} />;
  else if (route.view === "settings") {
    main = <SettingsView branch={branch} theme={theme} setTheme={setTheme} tree={tree.data} />;
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

  const railItem = ({ id, label, Icon }: NavItem, badge?: React.ReactNode) => (
    <button
      key={id}
      type="button"
      className="rail-item"
      data-active={route.view === id}
      aria-current={route.view === id ? "page" : undefined}
      onClick={() => navigate({ view: id })}
    >
      <Icon />
      <span>{label}</span>
      {badge}
    </button>
  );

  return (
    // One place decides icon weight and size, so glyphs stay optically
    // consistent with the 1px hairlines they sit beside.
    <IconContext.Provider value={{ size: 16, weight: "regular" }}>
      <div className="studio">
        <header className="topbar">
          <div className="topbar-left">
            <span className="brand">
              graft<b>.</b>
            </span>
            <span className="crumb-sep">/</span>
            <span className="scope">studio</span>
            <span className="crumb-sep">/</span>

            <Menu>
              <MenuTrigger className="branch-trigger">
                <span className="dot" data-state="synced" />
                {branch}
                <IconCaretUpDown size={12} className="branch-caret" />
              </MenuTrigger>
              <MenuContent>
                <MenuLabel>Switch branch</MenuLabel>
                {(branches.data?.branches ?? []).length === 0 ? (
                  <p className="menu-empty">No other branches registered.</p>
                ) : (
                  branches.data?.branches.map((row) => (
                    <MenuItem
                      key={row.name}
                      data-active={row.name === branch}
                      onClick={() => selectBranch(row.name)}
                    >
                      <span className="menu-item-label">{row.name}</span>
                      <span className="menu-item-hint">
                        {row.backend}
                        {row.parent ? ` ← ${row.parent}` : " · root"}
                      </span>
                    </MenuItem>
                  ))
                )}
              </MenuContent>
            </Menu>
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
              title={themeMeta.label}
              aria-label={themeMeta.label}
              onClick={() => setTheme(THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % 3] as Theme)}
            >
              <themeMeta.Icon size={15} />
            </button>
          </div>
        </header>

        <div className="body">
          {/* Collections live in the rail rather than in their own pane: it
              removes a whole column from the workspace, and the rail is
              already the "where am I" surface. Payload's model. */}
          <nav className="rail" aria-label="Studio sections">
            <div className="rail-group">{TOP.map((item) => railItem(item))}</div>

            <div className="rail-group">
              <p className="rail-label">Content</p>
              {collections.map((collection) => {
                const active =
                  route.view === "collections" && route.collection === collection.name;
                return (
                  <button
                    key={collection.name}
                    type="button"
                    className="rail-item"
                    data-active={active}
                    aria-current={active ? "page" : undefined}
                    onClick={() =>
                      navigate({ view: "collections", collection: collection.name })
                    }
                  >
                    <IdentityMark name={collection.name} size="sm" />
                    <span>{collection.name}</span>
                    {collection.authority === "db" ? (
                      <IconDatabase size={13} className="rail-mark" />
                    ) : collection.driftCount > 0 ? (
                      <span className="count" data-tone="drifted" data-numeric="">
                        {collection.driftCount}
                      </span>
                    ) : (
                      <span className="count" data-numeric="">
                        {collection.documents.length}
                      </span>
                    )}
                  </button>
                );
              })}
              {tree.loading && collections.length === 0 ? (
                <p className="rail-loading">Loading…</p>
              ) : null}
              {!tree.loading && collections.length === 0 ? (
                <p className="rail-loading">None registered</p>
              ) : null}
            </div>

            <div className="rail-group">
              <p className="rail-label">Operations</p>
              {OPERATIONS.map((item) =>
                railItem(
                  item,
                  item.id === "approvals" && pending > 0 ? (
                    <span className="count" data-tone="pending" data-numeric="">
                      {pending}
                    </span>
                  ) : undefined,
                ),
              )}
            </div>

            <div className="rail-group rail-group-end">{BOTTOM.map((item) => railItem(item))}</div>
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
          onOpenChange={setPaletteOpen}
          tree={tree.data}
          branches={branches.data}
          navigate={navigate}
          onSelectBranch={selectBranch}
          onCompile={() => void compile()}
        />
      </div>
    </IconContext.Provider>
  );
}
