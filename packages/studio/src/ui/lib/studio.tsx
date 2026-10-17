/**
 * What every view needs to know about the workspace, loaded once.
 *
 * The workspace says where saves land and what Publish does for this person;
 * drafts are the unpublished changes the top bar counts; the schema is what
 * every form is built from. They live in one context so a save anywhere can
 * refresh the count everywhere.
 */
import { createContext, useContext, type ReactNode } from "react";
import type { DraftsDto, PublishAction, WorkspaceDto } from "../../editor-types";
import type { SchemaCollectionDto, SchemaList } from "../../types";
import type { Route } from "./route";
import { useResource, type Resource } from "./use-resource";

export interface StudioState {
  workspace: Resource<WorkspaceDto>;
  drafts: Resource<DraftsDto>;
  schema: Resource<SchemaList>;
  /**
   * What Publish does for this person: from the workspace, which answers at
   * once, before the drafts, which can take a round trip to GitHub. Unknown
   * until either has loaded, so no button guesses "Publish" and changes.
   */
  publish: PublishAction | undefined;
  navigate: (route: Route) => void;
  openPublish: () => void;
  openCreate: (collection: string) => void;
}

const Context = createContext<StudioState | null>(null);

export function StudioProvider({ value, children }: { value: StudioState; children: ReactNode }) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useStudio(): StudioState {
  const value = useContext(Context);
  if (!value) throw new Error("useStudio outside StudioProvider");
  return value;
}

export function useStudioResources(): Pick<StudioState, "workspace" | "drafts" | "schema"> {
  return {
    workspace: useResource<WorkspaceDto>("/workspace"),
    drafts: useResource<DraftsDto>("/drafts"),
    schema: useResource<SchemaList>("/collections"),
  };
}

/** Whether this person's commit goes through. A contributor on a laptop saves drafts only. */
export function useCanPublish(): boolean {
  return useStudio().drafts.data?.canPublish ?? true;
}

/** Why the Commit button is off for a contributor. */
export const PUBLISH_NEEDS_EDITOR = "Committing needs an editor. Ask one to commit your changes.";

/** Collections an editor edits: the ones whose content is files. */
export function editableCollections(schema: SchemaList | null): SchemaCollectionDto[] {
  return (schema?.collections ?? []).filter((collection) => collection.authority === "file");
}

/** "products" -> "Products"; the singular for buttons: "New product". */
export function collectionLabel(name: string): string {
  const spaced = name.replace(/[-_]+/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Words whose plural is the singular: "New news" otherwise. Matched on the last word. */
const SAME_IN_SINGULAR = new Set(["news", "series", "species", "media", "data"]);

export function singular(name: string): string {
  const label = name.replace(/[-_]+/g, " ").toLowerCase();
  if (SAME_IN_SINGULAR.has(label.split(" ").pop() ?? "")) return label;
  if (/ies$/.test(label)) return label.replace(/ies$/, "y");
  if (/(ss|us)$/.test(label)) return label;
  if (/(ches|shes|xes|ses)$/.test(label)) return label.replace(/es$/, "");
  return label.replace(/s$/, "");
}

/**
 * Whether this Studio has a database: true or false once the workspace has
 * loaded, undefined before, and true in an embedded panel. A view asks for what lives in Postgres only when
 * it is true, so a Studio without one makes no request that would fail.
 */
export function useDatabase(): boolean | undefined {
  // An embedded panel has no Studio around it, and its host serves the API
  // it calls, database and all.
  const value = useContext(Context);
  return value ? value.workspace.data?.database : true;
}

/**
 * Why the workspace didn't load, and a way to ask again: null while it loads,
 * once it has, and in an embedded panel. A view that waits on it shows this
 * instead of a skeleton that would never end.
 */
export function useWorkspaceError(): { message: string; retry: () => void } | null {
  const value = useContext(Context);
  if (!value?.workspace.error || value.workspace.data) return null;
  return { message: value.workspace.error, retry: value.workspace.refresh };
}

/**
 * What a deletion means until it is published, for one entry or several. On
 * this computer the file is gone at once (`graft dev` stops showing it) and
 * only the deployed site keeps it until the deletion is committed and pushed.
 */
export function deletionNote(action: DraftsDto["publish"] | undefined, many = false): string {
  const it = many ? "They" : "It";
  if (action === "commit") {
    return `${many ? "Their files are" : "Its file is"} removed from this computer now. The deployed site keeps ${many ? "them" : "it"} until you commit the deletion and push.`;
  }
  return `${it} ${many ? "stay" : "stays"} live until you ${actionWord(action)} the deletion.`;
}

/** The verb inside a sentence: "until you commit the deletion". */
export function actionWord(action: DraftsDto["publish"] | undefined): string {
  if (action === "review") return "submit";
  if (action === "commit") return "commit";
  return "publish";
}

/** What finished work is called here: "committed" on a laptop, else "published". */
export function doneWord(action: DraftsDto["publish"] | undefined): string {
  return action === "commit" ? "committed" : "published";
}

/** What the Publish button says, for this person, in this workspace. */
export function publishVerb(action: DraftsDto["publish"] | undefined): string {
  if (action === "review") return "Submit for review";
  if (action === "commit") return "Commit";
  return "Publish";
}
