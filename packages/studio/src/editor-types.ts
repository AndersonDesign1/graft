/**
 * Wire shapes for the editor API (`/workspace`, `/entries`, `/entry`,
 * `/drafts`). Named in the editor's terms: an entry is a document as a person
 * sees it, a draft is an unpublished change, publishing is the act that makes
 * it live. Git, files and the index stay underneath.
 */
import type { ContentChangeNotice, ReviewRequest } from "@usegraft/compiler";

export type { ReviewRequest };

/**
 * Where an entry stands, for this person.
 * - `published`: no unpublished changes
 * - `changed`: edited since it was published
 * - `new`: never published
 * - `deleted`: deleted in the draft, still live until published
 */
export type EntryStatus = "published" | "changed" | "new" | "deleted";

/** A list column's value. Long text is cut; structured values are summarised. */
export type CellValue = string | number | boolean | null;

export interface EntrySummary {
  path: string;
  collection: string;
  slug: string;
  title: string;
  status: EntryStatus;
  conflict: boolean;
  /** Column values by field key, for the fields the list can show. */
  fields: Record<string, CellValue>;
  /** An asset key for a thumbnail, from the first image field. */
  image?: string;
  /** Last written, as the file system knows it. Local only. */
  updatedAt?: string;
  /** The frontmatter could not be read; the entry is listed so it can be fixed. */
  problem?: string;
}

export interface Facet {
  field: string;
  values: { value: string; count: number }[];
}

export interface EntryList {
  collection: string;
  /** Matches after search and filters. */
  total: number;
  items: EntrySummary[];
  /** Pass back as `cursor` for the next page; null on the last. */
  nextCursor: string | null;
  /** Totals for the whole collection, before search and filters. */
  counts: { all: number; unpublished: number };
  /** Values to filter by, for select, boolean and reference fields. */
  facets: Facet[];
}

export interface EntryDto {
  collection: string;
  slug: string;
  path: string;
  data: Record<string, unknown>;
  body: string;
  raw: string;
  /** Pass back as `baseVersion` when saving. Null for an entry being created. */
  version: string | null;
  status: EntryStatus;
  conflict: boolean;
}

export interface SaveEntryResult {
  collection: string;
  slug: string;
  path: string;
  /** The new version, to send as `baseVersion` on the next save. */
  version: string | null;
  status: EntryStatus;
  /** Present when a local save changed the index: whether the app was told to refresh. */
  refresh?: ContentChangeNotice;
}

/** What pressing Publish does for this person. */
export type PublishAction = "commit" | "publish" | "review";

export interface WorkspaceDto {
  /** Where saves land: files on this computer, GitHub, or the site's database. */
  storage: "local" | "github" | "database";
  repository?: string;
  repositoryUrl?: string;
  /** The branch publishing lands on. */
  branch?: string;
  publish: PublishAction;
  canWrite: boolean;
  /** Local: the content directory is under git, so Commit and Discard work. */
  history: boolean;
  /** Why history is unavailable, when it is. */
  historyReason?: string;
  user: {
    id: string;
    name: string | null;
    email: string | null;
    scopes: readonly string[];
  } | null;
  /**
   * Whether this request carried a Studio session cookie, so a Sign out
   * control makes sense. It does not say whether sign-in is configured.
   */
  sessions: boolean;
  /** People sign in with Studio accounts, and admins manage them under Settings. */
  accounts: boolean;
}

export type StudioRoleName = "viewer" | "contributor" | "editor" | "admin";

/** Someone who can sign in to Studio with an account. */
export interface PersonDto {
  id: string;
  email: string;
  name: string | null;
  role: StudioRoleName;
  /** Created the Studio on its first visit. */
  owner: boolean;
  /** The person asking. */
  you: boolean;
  createdAt: string;
}

/** An invitation nobody has used yet. */
export interface InviteDto {
  id: string;
  email: string;
  name: string | null;
  role: StudioRoleName;
  createdAt: string;
  expiresAt: string;
}

export interface PeopleDto {
  people: PersonDto[];
  invites: InviteDto[];
}

export interface DraftChangeDto {
  path: string;
  collection: string;
  slug: string;
  title: string;
  kind: "added" | "modified" | "deleted";
  conflict: boolean;
}

export interface DraftsDto {
  publish: PublishAction;
  /**
   * Whether this person may take that action. Locally, drafts are committed
   * straight to the checkout and there is no review to submit to, so a role
   * without publish rights (a contributor) can save drafts but not commit.
   */
  canPublish: boolean;
  changes: DraftChangeDto[];
  reviews: ReviewRequest[];
}

/** One top-level field that differs between the published version and the draft. */
export interface FieldChangeDto {
  field: string;
  before: unknown;
  after: unknown;
}

/**
 * A draft compared with what is published: the fields that changed, in
 * values an editor recognises, plus the line diff of the file for anyone who
 * wants the exact bytes.
 */
export interface DraftDiffDto {
  path: string;
  fields: FieldChangeDto[];
  bodyChanged: boolean;
  file: import("./types").FileDiffDto;
}

/** One published version of a document, in its history. */
export interface VersionDto {
  /** What `GET /entry/version` takes: a revision id or a commit SHA. */
  id: string;
  at: string;
  by?: string;
  byKind?: "human" | "agent";
  message?: string;
  /** This version deleted the document. */
  deleted?: boolean;
}

export interface VersionListDto {
  /** False where there is no history: no git locally, say. `reason` says why. */
  available: boolean;
  reason?: string;
  versions: VersionDto[];
}

export interface VersionDetailDto {
  id: string;
  path: string;
  /** The document at this version; null when the version deleted it. */
  raw: string | null;
  /** From this version to what the editor has now. */
  diff: DraftDiffDto;
}

/** A publish (or a commit) anywhere in the content, newest first. */
export interface ActivityEventDto {
  id: string;
  at: string;
  by?: string;
  byKind?: "human" | "agent";
  message?: string;
  /**
   * The first few documents it changed, as entries: deleted ones have no
   * slug to open. Empty where the store doesn't say which.
   */
  documents: ActivityDocumentDto[];
  /** How many more it changed beyond `documents`. */
  more: number;
}

export interface ActivityDocumentDto {
  path: string;
  collection: string;
  /** Absent when the document is gone now. */
  slug?: string;
  title: string;
}

export interface ActivityDto {
  available: boolean;
  reason?: string;
  events: ActivityEventDto[];
}

export interface PublishResultDto {
  action: PublishAction;
  published: string[];
  tookTheirs: string[];
  commit: { sha: string; shortSha: string; url?: string } | null;
  review?: ReviewRequest;
  /** Published straight to the live site, with no rebuild to wait for. */
  live?: boolean;
  /** Why a publish went to review: the site reviews deletions, some collections or large changes. */
  reviewReasons?: string[];
  /** Present when publishing changed the live index: whether the app was told to refresh. */
  refresh?: ContentChangeNotice;
}

/* ---- media, agents and site settings ---------------------------------- */

/** Where a file is used: an entry, and the field that holds it. */
export interface AssetUseDto {
  collection: string;
  slug: string;
  title: string;
  /** The field's path in the entry: `image`, or `gallery.2` for a list. */
  field: string;
}

/** A file in the media library: uploaded through Studio, or used by an entry. */
export interface AssetDto {
  key: string;
  /** Null for a file an entry uses that wasn't uploaded through Studio. */
  contentType: string | null;
  bytes: number | null;
  alt: string | null;
  uploadedBy: string | null;
  createdAt: string | null;
  /** A loadable URL, or null when the asset store isn't configured. */
  url: string | null;
  uses: number;
}

export interface AssetListDto {
  /** The asset store is configured, so files can be uploaded and shown. */
  storage: boolean;
  /** Why it isn't, when it isn't. */
  storageReason?: string;
  items: AssetDto[];
}

export interface AssetDetailDto extends AssetDto {
  usedIn: AssetUseDto[];
}

/** What an agent token may do, named for a person choosing it. */
export type AgentAccess = "read" | "write" | "publish";

export interface AgentTokenDto {
  id: string;
  name: string;
  /** The token's first characters, enough to tell two apart. */
  prefix: string;
  access: AgentAccess | "custom";
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface AgentsDto {
  tokens: AgentTokenDto[];
  /** Where an agent connects: the MCP endpoint and the Studio API. */
  endpoints: { mcp: string; api: string };
  /**
   * This host takes the tokens. False under `graft studio`, which has no MCP
   * endpoint: tokens made there work where the site runs `graft serve`.
   */
  accepted: boolean;
}

/** The token itself, returned once when it is made. */
export interface NewAgentTokenDto extends AgentTokenDto {
  token: string;
}

export interface SiteSettingsDto {
  name: string | null;
  url: string | null;
}

export interface DeployHookDto {
  id: string;
  name: string;
  /** Origin and path only: a hook's query often carries its own token. */
  url: string;
  hasSecret: boolean;
  createdAt: string;
  lastAt: string | null;
  lastStatus: number | null;
  lastError: string | null;
}

export interface SiteDto {
  settings: SiteSettingsDto;
  hooks: DeployHookDto[];
}
