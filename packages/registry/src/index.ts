/**
 * @graft/registry
 * The shadcn-style registry of owned, copy-in primitives behind `graft add`:
 * a validated item manifest, a local-first bundled registry, transitive
 * resolution, and the plan/apply that writes primitives + regenerates the
 * graft/ barrel. (docs/design-notes/registry.md.)
 */
export * from "./manifest";
export * from "./version";
export * from "./barrel";
export * from "./mdx-map";
export * from "./registry";
export * from "./add";
