/**
 * The registry item manifest — `registry.item.json` inside each bundled item.
 *
 * A registry item is a unit of owned, copy-in code (a shadcn-style primitive):
 * some files, the npm/registry things it needs first, a semver range against
 * @graft/core, and an optional llms.txt teaching fragment. Validated by this
 * Zod schema on load, so a malformed item is a REGISTRY_ITEM_INVALID up front —
 * never a half-written project. (See docs/design-notes/registry.md.)
 */
import { z } from "zod";

/** What kind of primitive this is — decides where its files conventionally land. */
export const ITEM_TYPES = ["block", "field", "access", "bundle"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

/**
 * A file the item ships. `role` decides how `graft add` treats it:
 * - `module`  → a `graft/*.ts` primitive that the barrel aggregates
 * - `component`→ a UI component (e.g. under components/)
 * - `content` → an authored MDX file
 * - `env`     → an env-var sample (printed, not merged, for now)
 */
export const FILE_ROLES = ["module", "component", "content", "env"] as const;
export type FileRole = (typeof FILE_ROLES)[number];

export const registryFileSchema = z.object({
  /** Path to the file inside the item directory. */
  source: z.string().min(1),
  /** Path to write, relative to the target project root. */
  target: z.string().min(1),
  role: z.enum(FILE_ROLES).default("module"),
});
export type RegistryFile = z.infer<typeof registryFileSchema>;

export const registryItemSchema = z.object({
  /** Item id — must equal its directory name. */
  name: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be lowercase kebab-case"),
  type: z.enum(ITEM_TYPES),
  description: z.string().min(1),
  /** Semver range against the installed @graft/core. "*" = any (pre-1.0 default). */
  graftVersion: z.string().default("*"),
  /** npm packages the target needs; printed for the operator to install (not run). */
  dependencies: z.record(z.string(), z.string()).default({}),
  /** Other registry items to add first (transitive, deduped, deps-first). */
  registryDependencies: z.array(z.string()).default([]),
  files: z.array(registryFileSchema).min(1),
  /** Path (inside the item dir) to an llms.txt fragment appended on add. */
  llms: z.string().min(1).optional(),
});
export type RegistryItemManifest = z.infer<typeof registryItemSchema>;

/** A loaded item: its validated manifest plus the absolute directory it lives in. */
export interface RegistryItem extends RegistryItemManifest {
  /** Absolute path to the item's directory in the bundled registry. */
  dir: string;
}
