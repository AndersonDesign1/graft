/**
 * @usegraft/core
 * The "everything is code" primitives: schema (defineCollection / field), the
 * function runtime (defineFunction / createFunctionsHandler), and later access
 * rules and the migration engine.
 */
export * from "./field";
export * from "./collection";
export * from "./data-migrations";
export * from "./function";
export * from "./functions-handler";
export * from "./primitives";
export * from "./records";
// Peer registration and the anonymous rate identity moved to
// @usegraft/contracts, so the content API can share the one
// implementation of the x-forwarded-for rule instead of copying it.
// Re-exported here because this is where callers already import them.
export { setRequestPeer, getRequestPeer, rateIdentity } from "@usegraft/contracts";
