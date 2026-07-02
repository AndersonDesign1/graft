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
  UNAUTHORIZED: {
    code: "UNAUTHORIZED",
    meaning: "The caller's token does not permit this operation.",
    typicalCauses: ["A missing or expired agent token", "A token scoped to reads used for a write"],
    howToRecover:
      "Obtain a token with the required scope from the project owner; do not retry with the same credentials.",
  },
  DESTRUCTIVE_OP_REQUIRES_APPROVAL: {
    code: "DESTRUCTIVE_OP_REQUIRES_APPROVAL",
    meaning:
      "The operation would destroy data and is human-gated regardless of the approval policy.",
    typicalCauses: ["Deleting a collection or branch", "A migration that drops columns or rows"],
    howToRecover:
      "Ask a human to approve the operation through the approval flow; never work around the gate.",
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
