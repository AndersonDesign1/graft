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
export {
  EDITOR_AUTH_ENV,
  ROLE_SCOPES,
  STUDIO_ROLES,
  createInviteLink,
  editorAccessFromEnv,
  isStudioRole,
  parseEditorList,
  type EditorAccessConfig,
  type StudioRole,
} from "./session";
export type { EditorAuthOptions, GitHubSignInOptions } from "./editor-auth";
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
