/**
 * @usegraft/studio — optional, opt-in Studio (Drizzle-style).
 *
 * Headless parity: the UI is only a client of the OpenAPI read surface;
 * the same operations exist on MCP and CLI.
 *
 * React panels: import from `@usegraft/studio/panels`.
 */
export { createStudioApiHandler, type StudioApiOptions, type StudioFetchHandler } from "./api";
export { createStudioHandler, type StudioHandlerOptions } from "./handler";
export { STUDIO_OPENAPI } from "./openapi";
export type {
  ApprovalList,
  BranchDto,
  BranchList,
  ChangeStatus,
  ChangedFileDto,
  CommitResultDto,
  CompilationDto,
  CompilationList,
  ContentTree,
  ContentTreeCollection,
  ContentTreeDoc,
  DiffHunkDto,
  DiffLineDto,
  DocumentDto,
  FileDiffDto,
  GitChangesDto,
  PendingApprovalDto,
} from "./types";

export const PACKAGE = "@usegraft/studio" as const;
