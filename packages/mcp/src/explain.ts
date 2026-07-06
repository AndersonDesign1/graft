/**
 * The self-teaching error knowledge base behind the `explain_error` tool.
 *
 * Every ErrorCode in @graft/contracts has an entry: what the failure means, what
 * usually causes it, and how to recover. A GraftError's `fix` is specific to one
 * failure; this registry is the general lesson an agent can apply next time.
 * A test asserts the registry stays in lockstep with ErrorCodes.
 */
import { ErrorCodes, type ErrorCode } from "@graft/contracts";

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
      "Fix graft.config.ts so it imports defineCollection/field from @graft/core and exports `collections` as a record of defineCollection results — the error message names exactly what failed to load or validate.",
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
      "Run the pending migration (content migrations update the files; DB migrations via @graft/db), then retry the operation.",
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
      "Ask a human operator to run `graft approve <approvalId>` (they can also `graft deny` it). Once approved, retry the EXACT same request with the header `x-graft-approval: <approvalId>`. Approvals are one-shot and bound to the exact input — never work around the gate.",
  },
  APPROVAL_INVALID: {
    code: "APPROVAL_INVALID",
    meaning:
      "An x-graft-approval header was sent, but that approval cannot authorize this call — details.reason says why (pending, denied, already_consumed, mismatch, or not_found).",
    typicalCauses: [
      "Retrying before a human has decided (pending)",
      "Reusing an approval — they are one-shot (already_consumed)",
      "Changing the input or function between request and retry (mismatch)",
      "A human refused the operation (denied)",
    ],
    howToRecover:
      "pending → wait for the human decision; denied → do not retry, ask the operator; already_consumed or not_found → call again without the header to file a fresh request; mismatch → retry with exactly the approved input.",
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
