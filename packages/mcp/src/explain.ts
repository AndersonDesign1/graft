/**
 * The self-teaching error knowledge base behind the `explain_error` tool.
 *
 * Every ErrorCode in @usegraft/contracts has an entry: what the failure means, what
 * usually causes it, and how to recover. A GraftError's `fix` is specific to one
 * failure; this registry is the general lesson an agent can apply next time.
 * A test asserts the registry stays in lockstep with ErrorCodes.
 */
import { ErrorCodes, type ErrorCode } from "@usegraft/contracts";

export interface ErrorExplanation {
  code: ErrorCode;
  meaning: string;
  typicalCauses: string[];
  howToRecover: string;
}

export const ERROR_KNOWLEDGE: Record<ErrorCode, ErrorExplanation> = {
  SCHEMA_VALIDATION_FAILED: {
    code: "SCHEMA_VALIDATION_FAILED",
    meaning: "A document's frontmatter does not satisfy its collection's Zod schema.",
    typicalCauses: [
      "A required field is missing from the frontmatter",
      "A field has the wrong type (e.g. a string where a number is expected)",
      "The schema changed in graft.config.ts and existing documents were not updated",
    ],
    howToRecover:
      "Call describe_schema to see the exact fields the collection expects, fix the frontmatter (the error's `details.issues` lists every violation), then retry the write or re-run compile.",
  },
  COLLECTION_NOT_FOUND: {
    code: "COLLECTION_NOT_FOUND",
    meaning: "Content referenced a collection that is not registered in the schema.",
    typicalCauses: [
      "A typo in the collection name",
      "A document placed in a folder that has no matching defineCollection",
      "The collection exists in code but was not passed to compile()/the MCP server",
    ],
    howToRecover:
      "Call list_collections to see what is registered. Either use one of those names, move the file into a registered collection folder, or add a defineCollection for it in graft.config.ts.",
  },
  CONFIG_NOT_FOUND: {
    code: "CONFIG_NOT_FOUND",
    meaning: "No graft.config.{ts,js} was found in the working directory or any parent.",
    typicalCauses: [
      "The command was run outside a Graft project",
      "The project has not been initialized yet",
    ],
    howToRecover:
      "cd into the project root (the directory holding graft.config.ts) and retry, or scaffold a new project with `graft init`.",
  },
  CONFIG_INVALID: {
    code: "CONFIG_INVALID",
    meaning:
      "graft.config exists but could not be loaded, or it does not export a valid `collections` record.",
    typicalCauses: [
      "A syntax or import error in graft.config.ts",
      "Missing `export const collections = { … }`",
      "A collections entry that was not created with defineCollection",
    ],
    howToRecover:
      "Fix graft.config.ts so it imports defineCollection/field from @usegraft/core and exports `collections` as a record of defineCollection results — the error message names exactly what failed to load or validate.",
  },
  ALREADY_INITIALIZED: {
    code: "ALREADY_INITIALIZED",
    meaning: "`graft init` was run in a directory that already has a graft.config.",
    typicalCauses: [
      "Re-running init in an existing project",
      "Pointing init at the wrong directory",
    ],
    howToRecover:
      "This is already a Graft project — evolve it by editing the existing graft.config.ts (add collections or fields there), or run `graft init <dir>` against an empty directory.",
  },
  ENV_VAR_MISSING: {
    code: "ENV_VAR_MISSING",
    meaning: "A required environment variable is not set.",
    typicalCauses: [
      "The project has no .env file yet",
      "The variable exists in a different environment (e.g. CI but not local)",
    ],
    howToRecover:
      "Add the variable named in `details.variable` to the project's .env (the CLI walks parent directories to find one) or export it in the environment, then retry.",
  },
  CONTENT_DIR_NOT_FOUND: {
    code: "CONTENT_DIR_NOT_FOUND",
    meaning: "The configured content directory does not exist on disk.",
    typicalCauses: [
      "The project has no content/ directory yet",
      "compile() was pointed at the wrong path",
    ],
    howToRecover:
      "Create the directory (documents live at <contentDir>/<collection>/<slug>.mdx) or correct the contentDir passed to compile()/the MCP server. write_content creates folders automatically.",
  },
  CONTENT_REFERENCE_NOT_FOUND: {
    code: "CONTENT_REFERENCE_NOT_FOUND",
    meaning: "A document references another document that does not exist.",
    typicalCauses: [
      "The referenced document was deleted or renamed",
      "A slug typo in the reference",
    ],
    howToRecover:
      "Create the missing document, or update the reference to point at an existing collection/slug (list_content shows what exists).",
  },
  DOCUMENT_NOT_FOUND: {
    code: "DOCUMENT_NOT_FOUND",
    meaning: "No document with the requested slug exists in that collection's files.",
    typicalCauses: [
      "A slug typo",
      "The document lives in a different collection",
      "The document was deleted (git is authoritative — the files are the truth)",
    ],
    howToRecover:
      "Call list_content for the collection to see every slug that exists, then retry with a real one — or author the document with write_content.",
  },
  FUNCTION_NOT_FOUND: {
    code: "FUNCTION_NOT_FOUND",
    meaning: "The invoked function name is not registered in the functions runtime.",
    typicalCauses: [
      "A typo in the function name (the last path segment of the POST URL)",
      "The function exists in code but was not included in the exported `functions` record",
    ],
    howToRecover:
      "The error's `details.available` lists every registered function — call one of those, or add a defineFunction to graft.config.ts and include it in the exported `functions`.",
  },
  INPUT_VALIDATION_FAILED: {
    code: "INPUT_VALIDATION_FAILED",
    meaning: "A function invocation's input does not satisfy the function's Zod input schema.",
    typicalCauses: [
      "The request body is not a JSON object",
      "A required input field is missing or has the wrong type",
    ],
    howToRecover:
      "Fix the fields listed in `details.issues` and retry. describe_schema shows each function's exact input fields; an empty body is treated as {}.",
  },
  FUNCTION_EXECUTION_FAILED: {
    code: "FUNCTION_EXECUTION_FAILED",
    meaning:
      "The function's handler threw an unexpected (non-Graft) error — a bug in the handler or its environment, not in the caller's input.",
    typicalCauses: [
      "A runtime error inside the handler code",
      "The database is unreachable or a required env var is missing on the server",
    ],
    howToRecover:
      "Retrying with the same input will fail again. Find the invocation in the server logs via `details.correlationId`, fix the handler code or the server environment, then retry.",
  },
  METHOD_NOT_ALLOWED: {
    code: "METHOD_NOT_ALLOWED",
    meaning: "The endpoint was called with an HTTP method it does not serve.",
    typicalCauses: [
      "GETting a function endpoint (functions are RPC over POST)",
      "A client following a redirect that downgraded the method",
    ],
    howToRecover:
      "Use the method named in the `Allow` response header — for Graft functions, POST a JSON object body to the same URL.",
  },
  ROUTE_NOT_FOUND: {
    code: "ROUTE_NOT_FOUND",
    meaning:
      "The Graft server (`graft serve`) has nothing mounted at the requested path — the request reached the right process but the wrong URL.",
    typicalCauses: [
      "A typo in the endpoint path (e.g. /api/fns instead of /api/fn/<name>)",
      "Expecting the frontend app's routes on the headless runtime — graft serve hosts only the function, MCP, and health endpoints",
    ],
    howToRecover:
      "Use POST /api/fn/<name> for typed functions, POST /api/mcp for the MCP Streamable HTTP surface, or GET /healthz for liveness. The error's details carry the path that missed.",
  },
  AUTHORITY_MISMATCH: {
    code: "AUTHORITY_MISMATCH",
    meaning:
      "An operation used the wrong interface for a collection's authority: files/write_content on a db-authoritative collection, or record helpers on a file-authoritative one.",
    typicalCauses: [
      "Authoring an MDX file for a collection whose rows live in Postgres",
      "Calling insertRecord/listRecords on a collection whose documents are files",
    ],
    howToRecover:
      "Check the collection's authority with describe_schema. File-authoritative → author MDX (write_content / files + compile). Db-authoritative → go through its functions (POST /api/fn/<name>); the rows are operational data Postgres owns.",
  },
  INDEX_OWNERSHIP: {
    code: "INDEX_OWNERSHIP",
    meaning:
      "A projection would soft-delete every document in collections this project's schema doesn't know — the signature of two projects pointing at one DATABASE_URL. Nothing was written; the transaction rolled back.",
    typicalCauses: [
      "DATABASE_URL points at another project's database (e.g. a shared repo-root .env)",
      "A collection was renamed or deleted in graft.config.ts, so its old rows look foreign",
    ],
    howToRecover:
      "Each project needs its own database or branch: set DATABASE_URL in a .env next to graft.config.ts (it overrides parent .envs). If the schema really did drop or rename a collection, a human runs `graft compile --prune-unknown` once — the override is CLI-only by design.",
  },
  NEEDS_DATABASE: {
    code: "NEEDS_DATABASE",
    meaning:
      'This project runs in static index mode (index = "static" in graft.config), and the requested feature is Postgres-tier: db-authoritative collections, typed functions, or database branching.',
    typicalCauses: [
      "A db-authoritative collection or a defineFunction was added to a static-mode project",
      "graft compile --branch <name> was run in static mode (branches are git branches there)",
    ],
    howToRecover:
      'Either stay static (content-only: use git branches for previews) or upgrade: set DATABASE_URL in .env and switch graft.config to `export const index = "postgres"`, then re-run `graft compile`.',
  },
  CONTENT_TREE_READ_ONLY: {
    code: "CONTENT_TREE_READ_ONLY",
    meaning:
      "A write reached the content tree, but the filesystem refused it. Authored content is files, so writing requires a writable checkout — serverless platforms deploy a read-only filesystem.",
    typicalCauses: [
      "Studio or an MCP write served from a serverless deployment (Vercel, Netlify, Cloudflare)",
      "A container with the project mounted read-only",
      "File permissions on the content directory",
    ],
    howToRecover:
      "Run the writing surface where the checkout is writable — local `graft studio` / `graft mcp`, or a self-hosted container with the project mounted read-write — and let the deployment serve reads only. Writes then arrive as git commits, which is the model: git is authoritative for authored content.",
  },
  GIT_UNAVAILABLE: {
    code: "GIT_UNAVAILABLE",
    meaning:
      "An operation needed git and could not reach it: either the `git` binary is not on PATH, or the content directory is not inside a git work tree.",
    typicalCauses: [
      "The project was scaffolded but `git init` was never run",
      "Studio or the CLI running in a container image that ships no git binary",
      "The content directory lives outside the repository (a mount, a symlink target)",
    ],
    howToRecover:
      "Run `git init` at the project root and make a first commit, or install git. Nothing else in Graft requires it — content still compiles and serves — but the change history, `graft compile`'s recorded SHA, and reverting all depend on it.",
  },
  COMMIT_FAILED: {
    code: "COMMIT_FAILED",
    meaning: "git refused to record the commit. The working tree is untouched by the refusal.",
    typicalCauses: [
      "No committer identity configured (user.name / user.email)",
      "A pre-commit or commit-msg hook rejected the change",
      "Nothing to commit — the selected paths match the last commit already",
      "The repository is mid-merge or mid-rebase",
    ],
    howToRecover:
      'The error\'s `details.stderr` carries git\'s own words. For an unset identity, run `git config user.name "…"` and `git config user.email "…"`. Selected files may already be staged; `git status` shows the current state, and committing from a terminal always remains available.',
  },
  STATIC_INDEX_NOT_FOUND: {
    code: "STATIC_INDEX_NOT_FOUND",
    meaning:
      "A read tried to open the static index artifact (.graft/index.db by default), but the file does not exist — the project has not been compiled yet.",
    typicalCauses: [
      "graft compile has never run in this checkout",
      "The artifact path in graft.config's `index` setting does not match where compile wrote it",
      "A deploy shipped the app without running graft compile in the build step",
    ],
    howToRecover:
      "Run `graft compile` (or add it before the framework build in the deploy's build command). The artifact must be deployed with the app.",
  },
  STATIC_INDEX_UNSUPPORTED: {
    code: "STATIC_INDEX_UNSUPPORTED",
    meaning:
      "Static index mode needs the node:sqlite built-in with FTS5, which this Node runtime does not provide (FTS5 ships in the bundled SQLite only from Node 22.16).",
    typicalCauses: ["Node older than 22.16 running the CLI or the app server"],
    howToRecover:
      'Upgrade Node to 22.16+ (24 LTS recommended), or switch the project to the Postgres index (DATABASE_URL + `export const index = "postgres"`).',
  },
  SLUG_NOT_UNIQUE: {
    code: "SLUG_NOT_UNIQUE",
    meaning: "Two documents in the same collection resolve to the same slug.",
    typicalCauses: [
      "Two files share a filename-derived slug",
      "A frontmatter `slug` duplicates another file's slug",
    ],
    howToRecover:
      "The error's details list both files. Give one of them a unique slug (frontmatter `slug:` wins over the filename) and re-run compile.",
  },
  INVALID_SLUG: {
    code: "INVALID_SLUG",
    meaning: "A slug is not URL-safe kebab-case.",
    typicalCauses: [
      "Uppercase letters, spaces, or punctuation in the slug or filename",
      "Leading/trailing/double hyphens",
    ],
    howToRecover:
      'Use lowercase letters, digits, and single hyphens only (e.g. "getting-started"). Set a valid `slug` in frontmatter or rename the file.',
  },
  MIGRATION_REQUIRED: {
    code: "MIGRATION_REQUIRED",
    meaning: "The schema and the stored content/data have drifted; a migration must run first.",
    typicalCauses: [
      "graft.config.ts changed shape while documents still use the old shape",
      "A database schema change is pending",
    ],
    howToRecover:
      "Run the pending migration (content migrations update the files; DB migrations via @usegraft/db), then retry the operation.",
  },
  MIGRATION_FAILED: {
    code: "MIGRATION_FAILED",
    meaning:
      "A content or data migration could not be applied; nothing was written (runs are all-or-nothing).",
    typicalCauses: [
      "The transform's output does not satisfy the collection's current schema",
      "The transform threw for some documents/rows",
      "A file's frontmatter is not parseable YAML",
    ],
    howToRecover:
      "Read details.failures — each entry names the file/row and why it failed. Fix the transform (or the listed files) in migrations/<id>.ts, then re-run `graft migrate --apply`. Dry-run first with `graft migrate` to see what would change.",
  },
  UNAUTHORIZED: {
    code: "UNAUTHORIZED",
    meaning: "The caller's token does not permit this operation.",
    typicalCauses: [
      "A missing or expired agent token",
      "A token scoped to reads used for a write",
      "An anonymous call to a mutation that is not marked `public: true` (the secure default)",
    ],
    howToRecover:
      "Obtain a token with the required scope from the project owner; do not retry with the same credentials. If the function is meant to accept anonymous callers, its definition needs `public: true`.",
  },
  TOKEN_INVALID: {
    code: "TOKEN_INVALID",
    meaning:
      "A bearer token was sent but could not be verified — different from sending no token (which makes the caller anonymous).",
    typicalCauses: [
      "An expired or not-yet-valid JWT",
      "A token issued by an issuer this deployment does not trust",
      "A wrong audience claim, a bad signature, or a malformed token",
    ],
    howToRecover:
      "Mint a fresh token from a trusted issuer (details.reason states what failed). Do not strip the Authorization header to fall back to anonymous — fix the token instead.",
  },
  RATE_LIMITED: {
    code: "RATE_LIMITED",
    meaning:
      "This caller has invoked the function more times than its per-window limit allows. Every attempt counts, including rejected ones.",
    typicalCauses: [
      "A retry loop hammering a function after failures",
      "Many calls from one actor (or one IP, for anonymous callers) in a short window",
    ],
    howToRecover:
      "Wait out the window (the Retry-After header says how long) before retrying, and fix whatever caused the burst — the limit is per caller per function, so backing off actually works.",
  },
  DESTRUCTIVE_OP_REQUIRES_APPROVAL: {
    code: "DESTRUCTIVE_OP_REQUIRES_APPROVAL",
    meaning:
      "The operation is human-gated: a pending approval request was filed (details.approvalId) and the call will not run until a human approves it. Destructive functions are always gated; under the 'human' approval policy every mutation is.",
    typicalCauses: [
      "Calling a function marked `destructive: true` (deletes or irreversibly overwrites data)",
      "Calling any mutation on a deployment whose approvalPolicy is 'human'",
    ],
    howToRecover:
      "Ask a human operator to run `graft approve <approvalId>` (they can also `graft deny` it). Once approved, retry the EXACT same call carrying the approval id — over MCP pass it as the `approval` tool argument; over raw HTTP send the `x-graft-approval: <approvalId>` header. Approvals are one-shot and bound to the exact input — never work around the gate.",
  },
  APPROVAL_INVALID: {
    code: "APPROVAL_INVALID",
    meaning:
      "An approval id was supplied (the `approval` argument over MCP, the x-graft-approval header over raw HTTP), but it cannot authorize this call — details.reason says why (pending, denied, already_consumed, mismatch, or not_found).",
    typicalCauses: [
      "Retrying before a human has decided (pending)",
      "Reusing an approval — they are one-shot (already_consumed)",
      "Changing the input or function between request and retry (mismatch)",
      "A human refused the operation (denied)",
    ],
    howToRecover:
      "pending → wait for the human decision; denied → do not retry, ask the operator; already_consumed or not_found → call again without the approval id to file a fresh request; mismatch → retry with exactly the approved input.",
  },
  APPROVAL_SELF_DECISION: {
    code: "APPROVAL_SELF_DECISION",
    meaning:
      "The identity deciding an approval is the same identity that requested it. Separation of duties: a requester can never approve (or deny) their own destructive operation.",
    typicalCauses: [
      "An agent (or a wrapper acting for it) running `graft approve` on an approval it filed itself",
      "Passing the requester's identity as the decider (e.g. reusing the same dev-token id)",
    ],
    howToRecover:
      "A DIFFERENT operator must review it: they run `graft approve <id>` (or `graft deny <id>`) under their own identity. Do not retry as the requester and do not switch identities to impersonate a reviewer — the gate exists so a second party sees the exact function + input before it runs.",
  },
  BRANCH_NOT_FOUND: {
    code: "BRANCH_NOT_FOUND",
    meaning: "An operation referenced a branch that is not registered in the topology.",
    typicalCauses: [
      "A typo in the branch name",
      "Forking from or dropping a branch that was never created",
      "Expecting a branch to exist that a teammate has not created yet",
    ],
    howToRecover:
      'List the registered branches (graft branch) to see valid names. "main" is always seeded; create previews off it before forking from or merging them.',
  },
  BRANCH_EXISTS: {
    code: "BRANCH_EXISTS",
    meaning: "A branch with that name is already registered.",
    typicalCauses: [
      "Re-running a create for a branch that already exists",
      "Two previews competing for the same name",
    ],
    howToRecover:
      "Use the existing branch, pick a different name, or drop the existing one first. Registering a branch is idempotent only if you check first — names are unique.",
  },
  BRANCH_INVALID: {
    code: "BRANCH_INVALID",
    meaning:
      "A branch operation was rejected because the name or the topology change is not allowed.",
    typicalCauses: [
      "A branch name that is not URL-safe (uppercase, spaces, punctuation)",
      "Making a branch its own parent, or dropping main",
      "Dropping a branch that still has child branches",
    ],
    howToRecover:
      'Use lowercase kebab names with optional "/" segments (e.g. "preview/checkout"). Fork previews from main; drop child branches before their parent; main is the root and cannot be dropped.',
  },
  BRANCH_BACKEND_FAILED: {
    code: "BRANCH_BACKEND_FAILED",
    meaning:
      "The branch backend's control plane (the Neon API for `neon` branches) rejected or failed an operation, so the branch's physical state may not match the registry.",
    typicalCauses: [
      "An invalid or expired NEON_API_KEY, or one scoped to a different project",
      "A wrong GRAFT_NEON_PROJECT_ID",
      "Neon-side limits (max branches) or a transient API outage",
      "The branch's compute endpoint never became reachable after create",
    ],
    howToRecover:
      "Check NEON_API_KEY and GRAFT_NEON_PROJECT_ID in the environment, then retry. If a create failed partway, the error says whether a Neon branch was left behind — delete it in the Neon console (or retry the drop) before recreating. Overlay branches never hit this: they need no external API.",
  },
  REGISTRY_ITEM_NOT_FOUND: {
    code: "REGISTRY_ITEM_NOT_FOUND",
    meaning: "`graft add` was asked for a registry item (a copy-in primitive) that does not exist.",
    typicalCauses: [
      "A typo in the item name",
      "Expecting a community/remote item — only the bundled Tier-1 registry ships today",
      "The item was renamed or removed",
    ],
    howToRecover:
      "The error's `details.available` lists every item you can add. Run `graft add <name>` with one of those, or build the primitive by hand as owned code under graft/.",
  },
  REGISTRY_ITEM_INVALID: {
    code: "REGISTRY_ITEM_INVALID",
    meaning:
      "A registry item's manifest is malformed, or the item requires a different @usegraft/core version than the one installed.",
    typicalCauses: [
      "registry.item.json does not match the manifest schema",
      "The item's `graftVersion` range does not include the installed core version",
      "A file the manifest lists is missing from the item directory",
    ],
    howToRecover:
      "The error names what failed (a manifest field or the version mismatch). For a version mismatch, move @usegraft/core to the range the item needs; a malformed manifest is a registry bug — fix the item or report it.",
  },
  REGISTRY_FILE_EXISTS: {
    code: "REGISTRY_FILE_EXISTS",
    meaning:
      "`graft add` would overwrite a file that already exists in the project, so it wrote nothing (adds are all-or-nothing).",
    typicalCauses: [
      "The item (or one of its dependencies) was already added",
      "A project file happens to share a target path with the item",
    ],
    howToRecover:
      "Inspect the listed file(s). If replacing them is intended, re-run with `--overwrite`; otherwise move/rename your file first. `graft add --dry-run <name>` previews every path an item would write.",
  },
  ASSET_EXISTS: {
    code: "ASSET_EXISTS",
    meaning:
      "An asset upload targeted a key that already holds a binary. The store has no version history, so an overwrite would irreversibly replace it — uploads refuse unless overwrite is explicit.",
    typicalCauses: [
      "Re-uploading with the same key instead of picking a new one",
      "Two documents' assets colliding on a generic key like assets/hero.png",
    ],
    howToRecover:
      "Pick a distinct key (e.g. prefix it with the document: pages/pricing/hero.png) — that is almost always right. Only pass `overwrite: true` when replacing the existing binary is the actual intent; every document referencing that key will show the new bytes.",
  },
  NOT_IMPLEMENTED: {
    code: "NOT_IMPLEMENTED",
    meaning: "The capability is planned but not built yet.",
    typicalCauses: ["Calling a placeholder API from a later phase"],
    howToRecover:
      "Use the documented alternative (the error's `fix` names it if one exists), or accomplish the task by editing files directly — git is always a valid interface.",
  },
};

/** Explanation for a code, or undefined if the code is unknown. */
export function explainCode(code: string): ErrorExplanation | undefined {
  return code in ErrorCodes ? ERROR_KNOWLEDGE[code as ErrorCode] : undefined;
}
