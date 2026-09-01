/**
 * Tool annotations — what each tool does to the world, declared once.
 *
 * These are the `ToolAnnotations` hints the MCP protocol has carried since
 * 2025-03-26, and Graft shipped none of them: every tool looked identical to a
 * client, so `search_content` and `delete_content` were offered on the same
 * terms. A client that asks a human before a destructive call had nothing to
 * key on, which is a strange gap in a product whose whole argument is that a
 * human stays in the loop for exactly those calls.
 *
 * They are **hints, not a boundary.** The spec says so, and it is right: a
 * client must never make an authorization decision on annotations from a server
 * it does not trust. Graft's real gates are elsewhere and unchanged — the scope
 * check in `requireScope`, the one-shot input-bound approval, the role
 * separation in Postgres. These make an honest client's UX good; they do not
 * make a dishonest one safe.
 *
 * `openWorldHint` is false on every tool. Graft's domain is the collections a
 * project declares — a closed set, known at config load. Nothing here searches
 * the web or reaches an open-ended set of external entities.
 */
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

/** Answers a question. Repeatable, reversible because it changes nothing. */
export const READS: ToolAnnotations = {
  readOnlyHint: true,
  openWorldHint: false,
};

/**
 * Changes something, but only ever adds or replaces a value the author can
 * restore. `destructiveHint: false` is the claim that undo exists — for content
 * that claim is git, and for anything where it is not true, use DESTROYS.
 */
export const WRITES: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

/**
 * May remove or overwrite something with no way back, or authorize a call that
 * will. Clients should confirm with a human before invoking one of these, which
 * is the same thing Graft's own approval gate insists on a layer further down.
 */
export const DESTROYS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
};
