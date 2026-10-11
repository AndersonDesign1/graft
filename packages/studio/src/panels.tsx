/**
 * Embed surface for `@usegraft/studio/panels`.
 *
 * The components live under `src/ui/`; this module is the stable public
 * shape. It deliberately imports no CSS — a host app embedding a panel
 * brings its own tokens, and tsup (which builds the lib) can't process
 * stylesheets. The standalone SPA pulls the styles in via `ui/main.tsx`.
 */
import { StudioApp } from "./ui/app";
import { ApprovalsView, BranchesView, HistoryView } from "./ui/views/operations";

export { StudioApp } from "./ui/app";

/**
 * The content workspace, standalone: the full editor (lists, entries,
 * publishing) without the host providing a shell. It owns its own hash route.
 */
export function ContentTreePanel({ branch = "main" }: { branch?: string }) {
  // StudioApp reads `branch` once, into state. Keyed on it, a host that
  // switches branch gets a fresh app on the new one instead of a stale view.
  return <StudioApp key={branch} branch={branch} />;
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
