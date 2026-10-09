import { IconContext } from "@phosphor-icons/react";
import { Toaster } from "sonner";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { EditorComponentList } from "@usegraft/contracts";
import type { ContentTree } from "../types";
import { CollectionMark } from "./components/collection-icon";
import { CreateDialog } from "./components/create-dialog";
import {
  IconApprovals,
  IconBranches,
  IconCaretDown,
  IconHistory,
  IconMoon,
  IconOverview,
  IconSchema,
  IconSearch,
  IconSettings,
  IconSun,
  IconSystem,
  type IconComponent,
} from "./components/icons";
import { setEditorComponentSpecs } from "./components/mdx-card";
import { CommandPalette } from "./components/palette";
import { PublishSheet } from "./components/publish-sheet";
import { SignIn } from "./components/sign-in";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
} from "./components/ui/menu";
import { SIGNED_OUT_EVENT, qs } from "./lib/api";
import { DEV_VIEWS, currentBranch, setBranchInUrl, useRoute, type DevView } from "./lib/route";
import {
  StudioProvider,
  collectionLabel,
  editableCollections,
  publishVerb,
  useStudioResources,
  type StudioState,
} from "./lib/studio";
import { useTheme, type Theme } from "./lib/theme";
import { useResource } from "./lib/use-resource";
import { CollectionView } from "./views/collection";
import { EntryView } from "./views/entry";
import { HomeView } from "./views/home";
import { ApprovalsView, BranchesView, HistoryView } from "./views/operations";
import { OverviewView } from "./views/overview";
import { SchemaView } from "./views/schema";
import { SettingsView } from "./views/settings";

const DEV_NAV: Array<{ view: DevView; label: string; Icon: IconComponent }> = [
  { view: "overview", label: "Health", Icon: IconOverview },
  { view: "schema", label: "Schema", Icon: IconSchema },
  { view: "history", label: "History", Icon: IconHistory },
  { view: "branches", label: "Branches", Icon: IconBranches },
  { view: "approvals", label: "Approvals", Icon: IconApprovals },
  { view: "settings", label: "Settings", Icon: IconSettings },
];

const THEME: Record<Theme, { label: string; Icon: IconComponent }> = {
  system: { label: "Match system", Icon: IconSystem },
  light: { label: "Light", Icon: IconSun },
  dark: { label: "Dark", Icon: IconMoon },
};

export function StudioApp({ branch: initialBranch = "main" }: { branch?: string }) {
  const [signedOut, setSignedOut] = useState(false);
  useEffect(() => {
    const onSignedOut = (): void => setSignedOut(true);
    window.addEventListener(SIGNED_OUT_EVENT, onSignedOut);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, onSignedOut);
  }, []);

  return (
    // One place decides icon weight and size, so glyphs stay optically
    // consistent with the 1px hairlines they sit beside.
    <IconContext.Provider value={{ size: 16, weight: "regular" }}>
      {signedOut ? <SignIn /> : <Shell initialBranch={initialBranch} />}
      <Toaster position="bottom-right" closeButton toastOptions={{ className: "sonner-toast" }} />
    </IconContext.Provider>
  );
}

function Shell({ initialBranch }: { initialBranch: string }) {
  const [branch, setBranch] = useState(() => currentBranch(initialBranch));
  const [route, navigate] = useRoute();
  const [theme, setTheme] = useTheme();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const resources = useStudioResources();
  const { workspace, drafts, schema } = resources;
  const developer = (DEV_VIEWS as readonly string[]).includes(route.view);
  const [devOpen, setDevOpen] = useState(developer);
  useEffect(() => {
    if (developer) setDevOpen(true);
  }, [developer]);

  // The developer views read the content tree; only they pay for it.
  const tree = useResource<ContentTree>(developer ? `/tree${qs({ branch })}` : null);
  const approvals = useResource<{ approvals: unknown[] }>("/approvals");

  // How this project's components present in the canvas.
  const editorComponents = useResource<EditorComponentList>("/editor-components");
  useEffect(() => {
    setEditorComponentSpecs(editorComponents.data?.components ?? []);
  }, [editorComponents.data]);

  const selectBranch = useCallback((name: string) => {
    setBranch(name);
    setBranchInUrl(name);
  }, []);

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

  const state: StudioState = useMemo(
    () => ({
      ...resources,
      navigate,
      openPublish: () => setPublishOpen(true),
      openCreate: (collection: string) => setCreating(collection),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resources.workspace, resources.drafts, resources.schema, navigate],
  );

  const collections = editableCollections(schema.data);
  const unpublished = drafts.data?.changes.length ?? 0;
  const pending = approvals.data?.approvals.length ?? 0;
  const user = workspace.data?.user;

  let main: React.ReactNode;
  if (route.view === "entry" && route.collection && route.slug) {
    main = (
      <EntryView
        key={`${route.collection}/${route.slug}`}
        collection={route.collection}
        slug={route.slug}
      />
    );
  } else if (route.view === "collection" && route.collection) {
    main = <CollectionView collection={route.collection} />;
  } else if (route.view === "overview") {
    main = <OverviewView branch={branch} tree={tree} navigate={navigate} />;
  } else if (route.view === "schema") main = <SchemaView />;
  else if (route.view === "approvals") main = <ApprovalsView onDecided={approvals.refresh} />;
  else if (route.view === "branches")
    main = <BranchesView branch={branch} onSelectBranch={selectBranch} />;
  else if (route.view === "history") main = <HistoryView branch={branch} />;
  else if (route.view === "settings") {
    main = <SettingsView branch={branch} theme={theme} setTheme={setTheme} tree={tree.data} />;
  } else main = <HomeView />;

  const crumbs = (
    <nav className="crumbs" aria-label="Breadcrumb">
      <a href="#/" className="crumb">
        Home
      </a>
      {route.collection ? (
        <>
          <span className="crumb-sep" aria-hidden="true">
            /
          </span>
          <a
            href={`#/c/${encodeURIComponent(route.collection)}`}
            className="crumb"
            aria-current={route.view === "collection" ? "page" : undefined}
          >
            {collectionLabel(route.collection)}
          </a>
        </>
      ) : null}
      {developer ? (
        <>
          <span className="crumb-sep" aria-hidden="true">
            /
          </span>
          <span className="crumb" aria-current="page">
            {DEV_NAV.find((item) => item.view === route.view)?.label}
          </span>
        </>
      ) : null}
    </nav>
  );

  return (
    <StudioProvider value={state}>
      <div className="shell">
        <aside className="side" aria-label="Studio">
          <div className="side-head">
            <a href="#/" className="wordmark" aria-label="Studio home">
              graft<b>.</b>
            </a>
            <span className="side-site" title={workspace.data?.repository ?? undefined}>
              {workspace.data?.repository?.split("/")[1] ?? "studio"}
            </span>
          </div>

          <button type="button" className="side-search" onClick={() => setPaletteOpen(true)}>
            <IconSearch size={14} />
            <span>Search</span>
            <kbd>⌘K</kbd>
          </button>

          <nav className="side-nav" aria-label="Content">
            <a
              href="#/"
              className="side-item"
              data-active={route.view === "home" || undefined}
              aria-current={route.view === "home" ? "page" : undefined}
            >
              <IconOverview size={15} />
              <span className="side-text">Home</span>
            </a>
            <p className="side-label">Content</p>
            {collections.map((collection) => {
              const active = route.collection === collection.name && !developer;
              const changed = (drafts.data?.changes ?? []).filter(
                (c) => c.collection === collection.name,
              ).length;
              return (
                <a
                  key={collection.name}
                  href={`#/c/${encodeURIComponent(collection.name)}`}
                  className="side-item"
                  data-active={active || undefined}
                  aria-current={active ? "page" : undefined}
                >
                  <CollectionMark name={collection.name} authority="file" size="sm" />
                  <span className="side-text">{collectionLabel(collection.name)}</span>
                  {changed > 0 ? (
                    <span
                      className="side-dot"
                      title={`${changed} unpublished`}
                      aria-label={`${changed} unpublished`}
                    />
                  ) : null}
                </a>
              );
            })}
          </nav>

          <div className="side-foot">
            <button
              type="button"
              className="side-label side-toggle"
              aria-expanded={devOpen}
              onClick={() => setDevOpen((v) => !v)}
            >
              Developer
              <IconCaretDown size={11} />
            </button>
            {devOpen ? (
              <nav className="side-nav" aria-label="Developer">
                {DEV_NAV.map(({ view, label, Icon }) => (
                  <a
                    key={view}
                    href={`#/dev/${view}`}
                    className="side-item"
                    data-active={route.view === view || undefined}
                    aria-current={route.view === view ? "page" : undefined}
                  >
                    <Icon size={15} />
                    <span className="side-text">{label}</span>
                    {view === "approvals" && pending > 0 ? (
                      <span className="side-count" data-numeric="">
                        {pending}
                      </span>
                    ) : null}
                  </a>
                ))}
              </nav>
            ) : null}

            <Menu>
              <MenuTrigger className="side-user">
                <span className="avatar" aria-hidden="true">
                  {(user?.name ?? user?.id ?? "You").slice(0, 1).toUpperCase()}
                </span>
                <span className="side-user-text">
                  <span className="side-user-name">{user?.name ?? user?.id ?? "Local editor"}</span>
                  <span className="side-user-role">
                    {workspace.data?.storage === "github"
                      ? `Saving to ${workspace.data.branch ? "GitHub" : "GitHub"}`
                      : "Saving on this computer"}
                  </span>
                </span>
              </MenuTrigger>
              <MenuContent align="start" side="top">
                <MenuLabel>Appearance</MenuLabel>
                {(Object.keys(THEME) as Theme[]).map((key) => {
                  const { label, Icon } = THEME[key];
                  return (
                    <MenuItem
                      key={key}
                      data-active={theme === key || undefined}
                      onClick={() => setTheme(key)}
                    >
                      <Icon size={14} />
                      <span className="menu-item-label">{label}</span>
                    </MenuItem>
                  );
                })}
                {workspace.data?.sessions ? (
                  <>
                    <MenuSeparator />
                    <MenuItem
                      onClick={() => {
                        void fetch("/api/studio/v1/auth/sign-out", {
                          method: "POST",
                          credentials: "same-origin",
                        }).then(() => window.location.reload());
                      }}
                    >
                      <span className="menu-item-label">Sign out</span>
                    </MenuItem>
                  </>
                ) : null}
              </MenuContent>
            </Menu>
          </div>
        </aside>

        <div className="stage">
          <header className="bar">
            {crumbs}
            <span className="bar-spacer" />
            {workspace.data?.storage === "github" && workspace.data.repositoryUrl ? (
              <a
                className="bar-repo"
                href={workspace.data.repositoryUrl}
                target="_blank"
                rel="noreferrer"
                title="The repository your content lives in"
              >
                {workspace.data.repository}
                {workspace.data.branch ? (
                  <span className="muted"> · {workspace.data.branch}</span>
                ) : null}
              </a>
            ) : null}
            <button
              type="button"
              className="publish"
              data-pending={unpublished > 0 || undefined}
              onClick={() => setPublishOpen(true)}
              disabled={workspace.data ? !workspace.data.canWrite : false}
            >
              {publishVerb(drafts.data?.publish)}
              {unpublished > 0 ? (
                <span
                  className="publish-count"
                  data-numeric=""
                  aria-label={`${unpublished} unpublished`}
                >
                  {unpublished}
                </span>
              ) : null}
            </button>
          </header>
          <main className="main">{main}</main>
        </div>

        <PublishSheet
          open={publishOpen}
          onOpenChange={setPublishOpen}
          onDone={() => {
            drafts.refresh();
          }}
        />
        <CreateDialog
          collection={creating}
          onOpenChange={(open) => !open && setCreating(null)}
          onCreated={drafts.refresh}
        />
        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          components={editorComponents.data?.components ?? []}
        />
      </div>
    </StudioProvider>
  );
}
