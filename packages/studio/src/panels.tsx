/**
 * Embed surface for `@graft/studio/panels`.
 *
 * The components live under `src/ui/`; this module is the stable public
 * shape. It deliberately imports no CSS — a host app embedding a panel
 * brings its own tokens, and tsup (which builds the lib) can't process
 * stylesheets. The standalone SPA pulls the styles in via `ui/main.tsx`.
 */
import { useEffect } from "react";
import { CollectionsView } from "./ui/views/collections";
import { ApprovalsView, BranchesView, HistoryView } from "./ui/views/operations";
import { qs } from "./ui/lib/api";
import { parseHash, toHash, useRoute } from "./ui/lib/route";
import { useResource } from "./ui/lib/use-resource";
import type { ContentTree } from "./types";

export { StudioApp } from "./ui/app";

/** Full content workspace, standalone. */
export function ContentTreePanel({ branch = "main" }: { branch?: string }) {
  const [route, navigate] = useRoute();
  const tree = useResource<ContentTree>(`/tree${qs({ branch })}`);

  // Embedded, the panel owns no shell, so seed the route if the host hasn't.
  useEffect(() => {
    if (parseHash(window.location.hash).view !== "collections") {
      window.location.hash = toHash({ view: "collections" });
    }
  }, []);

  return (
    <CollectionsView
      branch={branch}
      route={route}
      navigate={navigate}
      tree={tree}
      onSaved={tree.refresh}
    />
  );
}

export function ApprovalQueuePanel() {
  return <ApprovalsView />;
}

export function BranchListPanel({
  branch,
  onSelectBranch,
}: {
  branch: string;
  onSelectBranch?: (name: string) => void;
}) {
  return <BranchesView branch={branch} onSelectBranch={onSelectBranch ?? (() => {})} />;
}

export function CompilationTrailPanel({ branch = "main" }: { branch?: string }) {
  return <HistoryView branch={branch} />;
}
