/**
 * What every view needs to know about the workspace, loaded once.
 *
 * The workspace says where saves land and what Publish does for this person;
 * drafts are the unpublished changes the top bar counts; the schema is what
 * every form is built from. They live in one context so a save anywhere can
 * refresh the count everywhere.
 */
import { createContext, useContext, type ReactNode } from "react";
import type { DraftsDto, WorkspaceDto } from "../../editor-types";
import type { SchemaCollectionDto, SchemaList } from "../../types";
import type { Route } from "./route";
import { useResource, type Resource } from "./use-resource";

export interface StudioState {
  workspace: Resource<WorkspaceDto>;
  drafts: Resource<DraftsDto>;
  schema: Resource<SchemaList>;
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

/** What the Publish button says, for this person, in this workspace. */
export function publishVerb(action: DraftsDto["publish"] | undefined): string {
  if (action === "review") return "Submit for review";
  if (action === "commit") return "Commit";
  return "Publish";
}
