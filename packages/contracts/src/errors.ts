/**
 * Error codes + the GraftError shape.
 *
 * Every Graft error carries an agent-actionable `fix` — the next concrete step an
 * agent (or human) can take to resolve it. This is part of the "self-teaching"
 * pillar: failures explain how to recover, not just what went wrong.
 */

export const ErrorCodes = {
  SCHEMA_VALIDATION_FAILED: "SCHEMA_VALIDATION_FAILED",
  COLLECTION_NOT_FOUND: "COLLECTION_NOT_FOUND",
  CONFIG_NOT_FOUND: "CONFIG_NOT_FOUND",
  CONFIG_INVALID: "CONFIG_INVALID",
  ALREADY_INITIALIZED: "ALREADY_INITIALIZED",
  ENV_VAR_MISSING: "ENV_VAR_MISSING",
  CONTENT_DIR_NOT_FOUND: "CONTENT_DIR_NOT_FOUND",
  CONTENT_REFERENCE_NOT_FOUND: "CONTENT_REFERENCE_NOT_FOUND",
  DOCUMENT_NOT_FOUND: "DOCUMENT_NOT_FOUND",
  SLUG_NOT_UNIQUE: "SLUG_NOT_UNIQUE",
  INVALID_SLUG: "INVALID_SLUG",
  MIGRATION_REQUIRED: "MIGRATION_REQUIRED",
  UNAUTHORIZED: "UNAUTHORIZED",
  DESTRUCTIVE_OP_REQUIRES_APPROVAL: "DESTRUCTIVE_OP_REQUIRES_APPROVAL",
  NOT_IMPLEMENTED: "NOT_IMPLEMENTED",
} as const;

export type ErrorCode = keyof typeof ErrorCodes;

export interface GraftErrorJSON {
  error: ErrorCode;
  message: string;
  fix?: string;
  details?: Record<string, unknown>;
}

export interface GraftErrorOptions {
  code: ErrorCode;
  message: string;
  /** Agent-actionable next step, e.g. "create pages/about.mdx or fix the reference in nav.ts". */
  fix?: string;
  details?: Record<string, unknown>;
}

export class GraftError extends Error {
  readonly code: ErrorCode;
  readonly fix?: string;
  readonly details?: Record<string, unknown>;

  constructor(options: GraftErrorOptions) {
    super(options.message);
    this.name = "GraftError";
    this.code = options.code;
    this.fix = options.fix;
    this.details = options.details;
  }

  toJSON(): GraftErrorJSON {
    return {
      error: this.code,
      message: this.message,
      fix: this.fix,
      details: this.details,
    };
  }
}
