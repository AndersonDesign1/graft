import { LucideProvider } from "lucide-react";
import { Toaster } from "sonner";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { EditorComponentList } from "@usegraft/contracts";
import type { ContentTree } from "../types";
import { CollectionMark } from "./components/collection-icon";
import { CreateDialog } from "./components/create-dialog";
import { ErrorBoundary } from "./components/error-boundary";
import {
  IconAgents,
  IconInbox,
  IconMedia,
  IconBranches,
  IconCaretDown,
  IconCheck,
  IconHistory,
  IconHome,
  IconMenu,
  IconMoon,
  IconOverview,
  IconSchema,
  IconSearch,
  IconSettings,
  IconSignOut,
  IconSun,
  IconSystem,
  type IconComponent,
} from "./components/icons";
import { setEditorComponentSpecs } from "./components/mdx-card";
import { CommandPalette } from "./components/palette";
import { PublishSheet } from "./components/publish-sheet";
import { ListPane } from "./components/list-pane";
import { AcceptInvite, SignIn } from "./components/sign-in";
import { ConfirmProvider } from "./components/ui/confirm";
import { Dialog, DialogContent } from "./components/ui/dialog";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSection,
  MenuSeparator,
  MenuTrigger,
} from "./components/ui/menu";
import { TooltipProvider } from "./components/ui/tooltip";
import { MOD_KEY } from "./lib/keys";
import { SIGNED_OUT_EVENT, qs } from "./lib/api";
import {
  DEV_VIEWS,
  currentBranch,
  setBranchInUrl,
  toHash,
  useRoute,
  type DevView,
  type Route,
} from "./lib/route";
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
import { BranchesView, HistoryView } from "./views/operations";
import { AgentsView } from "./views/agents";
import { RequiresDatabase } from "./components/primitives";
import { InboxView } from "./views/inbox";
import { MediaView } from "./views/media";
import { OverviewView } from "./views/overview";
import { SchemaView } from "./views/schema";
import { SettingsView } from "./views/settings";

const DEV_NAV: Array<{ view: DevView; label: string; Icon: IconComponent }> = [
  { view: "overview", label: "Health", Icon: IconOverview },
  { view: "schema", label: "Schema", Icon: IconSchema },
  { view: "history", label: "History", Icon: IconHistory },
  { view: "branches", label: "Branches", Icon: IconBranches },
  { view: "agents", label: "Agents", Icon: IconAgents },
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
  // An invitation link opens Studio with ?invite=, signed in or not.
  const [invite] = useState(() => new URLSearchParams(window.location.search).get("invite"));

  return (
    // One place decides icon size and stroke: Lucide at 16px and 1.75, as in
    // the docs.
    <LucideProvider size={16} strokeWidth={1.75}>
      {invite ? (
        <AcceptInvite token={invite} />
      ) : signedOut ? (
        <SignIn />
      ) : (
        <ErrorBoundary scope="page">
          <Shell initialBranch={initialBranch} />
        </ErrorBoundary>
      )}
      <Toaster position="bottom-right" closeButton visibleToasts={1} duration={5000} />
    </LucideProvider>
  );
}

function Shell({ initialBranch }: { initialBranch: string }) {
  const [branch, setBranch] = useState(() => currentBranch(initialBranch));
  const [route, navigate] = useRoute();
  const [theme, setTheme] = useTheme();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  // Choosing a destination in the phone drawer closes it.
  useEffect(() => setNavOpen(false), [route]);
  const [publishOpen, setPublishOpen] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const resources = useStudioResources();
  const { workspace, drafts, schema } = resources;
  const developer = (DEV_VIEWS as readonly string[]).includes(route.view);
  const [devOpen, setDevOpen] = useState(developer);
  useEffect(() => {
    if (developer) setDevOpen(true);
  }, [developer]);

  // The developer views read the content tree; only they pay for it. Read
  // again after every save, publish, discard or delete, so the counts in
  // Health and Settings are never from before the last change.
  const tree = useResource<ContentTree>(developer ? `/tree${qs({ branch })}` : null, [drafts.data]);
  const approvals = useResource<{ approvals: unknown[] }>(
    workspace.data?.database ? "/approvals" : null,
    [workspace.data?.database],
  );

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
      publish: resources.workspace.data?.publish ?? resources.drafts.data?.publish,
      navigate,
      openPublish: () => setPublishOpen(true),
      openCreate: (collection: string) => setCreating(collection),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resources.workspace, resources.drafts, resources.schema, navigate],
  );

  const collections = editableCollections(schema.data);
  const unpublished = drafts.data?.changes.length ?? 0;
  const publish = state.publish;
  // What the inbox holds: agents asking first, and changes sent for review.
  const pending = (approvals.data?.approvals.length ?? 0) + (drafts.data?.reviews.length ?? 0);
  const user = workspace.data?.user;
  // Agent tokens are an admin's to give out; a Studio with no sign-in is its owner's.
  const canManageAgents = workspace.data ? !user || user.scopes.includes("studio:settings") : false;

  let main: React.ReactNode;
  if (route.view === "entry" && route.collection && route.slug) {
    // Panes, not pages: the collection stays beside the open entry.
    main = (
      <div className="workspace">
        <ListPane collection={route.collection} selected={route.slug} />
        <EntryView
          key={`${route.collection}/${route.slug}`}
          collection={route.collection}
          slug={route.slug}
        />
      </div>
    );
  } else if (route.view === "collection" && route.collection) {
    main = <CollectionView key={route.collection} collection={route.collection} />;
  } else if (route.view === "overview") {
    main = (
      <OverviewView
        branch={branch}
        tree={tree}
        navigate={navigate}
        canWrite={workspace.data?.canWrite ?? false}
      />
    );
  } else if (route.view === "schema") main = <SchemaView />;
  else if (route.view === "inbox") main = <InboxView onDecided={approvals.refresh} />;
  else if (route.view === "media") main = <MediaView />;
  else if (route.view === "agents") {
    main = (
      <RequiresDatabase
        view="Agents"
        title="Agent tokens need a database"
        does="Each agent's token is kept in Postgres, with what it may do and when it was last used."
      >
        <AgentsView />
      </RequiresDatabase>
    );
  } else if (route.view === "branches") {
    main = (
      <RequiresDatabase
        view="Branches"
        title="Branches need a database"
        does="A branch is an index of its own in Postgres, for previewing changes before they go live. Without one, use Git branches."
      >
        <BranchesView branch={branch} onSelectBranch={selectBranch} />
      </RequiresDatabase>
    );
  } else if (route.view === "history") {
    main = (
      <RequiresDatabase
        view="History"
        title="The compile history needs a database"
        does="Every compile is recorded in Postgres with the commit it read, which is what lets you see and restore earlier ones. Each entry's own history, from Git, is in its panel."
      >
        <HistoryView branch={branch} />
      </RequiresDatabase>
    );
  } else if (route.view === "settings") {
    main = <SettingsView branch={branch} theme={theme} setTheme={setTheme} tree={tree.data} />;
  } else main = <HomeView />;

  const userName = user?.name ?? user?.id ?? "Local editor";
  const savingTo =
    workspace.data?.storage === "github"
      ? "Saving to GitHub"
      : workspace.data?.storage === "database"
        ? "Saving to the site's database"
        : "Saving on this computer";

  const nav = (
    <SideNav
      route={route}
      collections={collections.map((c) => c.name)}
      drafts={drafts.data?.changes ?? []}
      developer={developer}
      devOpen={devOpen}
      onToggleDev={() => setDevOpen((v) => !v)}
      pending={pending}
      canManageAgents={canManageAgents}
    />
  );

  return (
    <StudioProvider value={state}>
      <ConfirmProvider>
        <TooltipProvider delay={500}>
          <div className="shell">
            <header className="top">
              <div className="top-start">
                <button
                  type="button"
                  className="icon-btn top-menu"
                  aria-label="Open navigation"
                  onClick={() => setNavOpen(true)}
                >
                  <IconMenu />
                </button>
                <a href="#/" className="wordmark" aria-label="Studio home">
                  graft.
                  <span className="wordmark-sep" aria-hidden="true">
                    /
                  </span>
                  <span className="wordmark-surface">Studio</span>
                </a>
                {workspace.data?.storage === "github" && workspace.data.repositoryUrl ? (
                  <a
                    className="top-repo"
                    href={workspace.data.repositoryUrl}
                    target="_blank"
                    rel="noreferrer"
                    title="The repository your content lives in"
                  >
                    {workspace.data.repository}
                    {workspace.data.branch ? ` · ${workspace.data.branch}` : ""}
                  </a>
                ) : (
                  <a
                    className="top-branch"
                    href="#/dev/branches"
                    title="The branch Studio reads and writes"
                  >
                    <IconBranches size={14} />
                    <span>{branch}</span>
                  </a>
                )}
              </div>

              <button
                type="button"
                className="top-search"
                aria-label="Search"
                aria-keyshortcuts="Meta+K Control+K"
                onClick={() => setPaletteOpen(true)}
              >
                <IconSearch />
                <span>Search</span>
                <span className="top-search-keys" aria-hidden="true">
                  <kbd>{MOD_KEY}</kbd>
                  <kbd>K</kbd>
                </span>
              </button>

              <div className="top-end">
                {publish ? (
                  <button
                    type="button"
                    className="publish"
                    data-pending={unpublished > 0 || undefined}
                    onClick={() => setPublishOpen(true)}
                    disabled={workspace.data ? !workspace.data.canWrite : false}
                  >
                    {publishVerb(publish)}
                    {unpublished > 0 ? (
                      <span
                        className="publish-count"
                        data-numeric=""
                        aria-label={`${unpublished} ${unpublished === 1 ? "draft" : "drafts"}`}
                      >
                        {unpublished}
                      </span>
                    ) : null}
                  </button>
                ) : null}
                <Menu>
                  <MenuTrigger className="top-account" aria-label={`${userName}, ${savingTo}`}>
                    <span className="avatar" aria-hidden="true">
                      {userName.slice(0, 1).toUpperCase()}
                    </span>
                  </MenuTrigger>
                  <MenuContent align="end">
                    <div className="menu-head">
                      <b>{userName}</b>
                      <span>{savingTo}</span>
                    </div>
                    <MenuSection label="Appearance">
                      {(Object.keys(THEME) as Theme[]).map((key) => {
                        const { label, Icon } = THEME[key];
                        return (
                          <MenuItem
                            key={key}
                            data-active={theme === key || undefined}
                            onClick={() => setTheme(key)}
                          >
                            <Icon />
                            <span className="menu-item-label">{label}</span>
                            {theme === key ? <IconCheck aria-label="Selected" /> : null}
                          </MenuItem>
                        );
                      })}
                    </MenuSection>
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
                          <IconSignOut />
                          <span className="menu-item-label">Sign out</span>
                        </MenuItem>
                      </>
                    ) : null}
                  </MenuContent>
                </Menu>
              </div>
            </header>

            <aside className="side" aria-label="Studio">
              {nav}
            </aside>

            <main className="main">
              {/* Keyed by route, so leaving a view that crashed brings the panel back. */}
              <ErrorBoundary key={toHash(route)} scope="view">
                {main}
              </ErrorBoundary>
            </main>

            {/* Below 48rem the sidebar lives here, behind the menu button. */}
            <Dialog open={navOpen} onOpenChange={setNavOpen}>
              <DialogContent className="drawer" aria-label="Navigation">
                <div className="drawer-head">
                  <a href="#/" className="wordmark" onClick={() => setNavOpen(false)}>
                    graft.
                    <span className="wordmark-sep" aria-hidden="true">
                      /
                    </span>
                    <span className="wordmark-surface">Studio</span>
                  </a>
                </div>
                {nav}
              </DialogContent>
            </Dialog>

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
        </TooltipProvider>
      </ConfirmProvider>
    </StudioProvider>
  );
}

/** The navigation, shared by the sidebar and the phone drawer. */
function SideNav({
  route,
  collections,
  drafts,
  developer,
  devOpen,
  onToggleDev,
  pending,
  canManageAgents,
}: {
  route: Route;
  collections: readonly string[];
  drafts: readonly { collection: string }[];
  developer: boolean;
  devOpen: boolean;
  onToggleDev: () => void;
  pending: number;
  canManageAgents: boolean;
}) {
  return (
    <>
      <nav className="side-nav" aria-label="Content">
        <a
          href="#/"
          className="side-item"
          data-active={route.view === "home" || undefined}
          aria-current={route.view === "home" ? "page" : undefined}
        >
          <IconHome />
          <span className="side-text">Home</span>
        </a>
        <a
          href="#/inbox"
          className="side-item"
          data-active={route.view === "inbox" || undefined}
          aria-current={route.view === "inbox" ? "page" : undefined}
        >
          <IconInbox />
          <span className="side-text">Inbox</span>
          {pending > 0 ? (
            <span className="side-count" data-numeric="" aria-label={`${pending} waiting`}>
              {pending}
            </span>
          ) : null}
        </a>
        <a
          href="#/media"
          className="side-item"
          data-active={route.view === "media" || undefined}
          aria-current={route.view === "media" ? "page" : undefined}
        >
          <IconMedia />
          <span className="side-text">Media</span>
        </a>
        <p className="side-label">Content</p>
        {collections.map((name) => {
          const active = route.collection === name && !developer;
          const count = drafts.filter((change) => change.collection === name).length;
          return (
            <a
              key={name}
              href={`#/c/${encodeURIComponent(name)}`}
              className="side-item"
              data-active={active || undefined}
              aria-current={active ? "page" : undefined}
            >
              <CollectionMark name={name} authority="file" />
              <span className="side-text">{collectionLabel(name)}</span>
              {count > 0 ? (
                <span
                  className="side-dot"
                  title={`${count} ${count === 1 ? "draft" : "drafts"}`}
                  aria-label={`${count} ${count === 1 ? "draft" : "drafts"}`}
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
          onClick={onToggleDev}
        >
          Developer
          <IconCaretDown size={14} />
        </button>
        {devOpen ? (
          <nav className="side-nav" aria-label="Developer">
            {DEV_NAV.filter((item) => item.view !== "agents" || canManageAgents).map(
              ({ view, label, Icon }) => (
                <a
                  key={view}
                  href={`#/dev/${view}`}
                  className="side-item"
                  data-active={route.view === view || undefined}
                  aria-current={route.view === view ? "page" : undefined}
                >
                  <Icon />
                  <span className="side-text">{label}</span>
                </a>
              ),
            )}
          </nav>
        ) : null}
      </div>
    </>
  );
}
