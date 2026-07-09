/**
 * Locate, load, validate, and resolve bundled registry items.
 *
 * The registry is local-first: items live under this package's `registry/`
 * directory (resolved via import.meta.url so it works from src in tests and from
 * dist when installed). A remote HTTP registry would swap `registryRoot` +
 * `loadItem` for a fetch — the manifest shape is already the wire format.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GraftError, type RegistryItemDescriptor } from "@graft/contracts";
import { registryItemSchema, type RegistryItem } from "./manifest";
import { satisfies } from "./version";

const MANIFEST_FILE = "registry.item.json";

/**
 * The bundled registry root — the sibling `registry/` dir (one level up from src
 * or dist). Built from `import.meta.url` via path.join rather than
 * `new URL("../registry", import.meta.url)` so bundlers (Turbopack in the Next
 * example) don't try to statically resolve the directory as a module asset; it
 * stays plain runtime code. The package is server-external where it runs bundled.
 */
export function registryRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "registry");
}

/** Names of every bundled item (a subdirectory holding a manifest), sorted. */
export function listItemNames(root = registryRoot()): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, MANIFEST_FILE)))
    .map((entry) => entry.name)
    .sort();
}

/** Load + validate one item by name. Throws REGISTRY_ITEM_NOT_FOUND / _INVALID. */
export function loadItem(name: string, root = registryRoot()): RegistryItem {
  const dir = join(root, name);
  const manifestPath = join(dir, MANIFEST_FILE);
  if (!existsSync(manifestPath)) {
    const available = listItemNames(root);
    throw new GraftError({
      code: "REGISTRY_ITEM_NOT_FOUND",
      message: `No registry item named "${name}".`,
      fix: `Add one of the available items instead: ${available.join(", ") || "(none bundled)"}.`,
      details: { name, available },
    });
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new GraftError({
      code: "REGISTRY_ITEM_INVALID",
      message: `Item "${name}" has an unparseable ${MANIFEST_FILE}: ${error instanceof Error ? error.message : String(error)}`,
      fix: "This is a registry bug — the manifest must be valid JSON. Fix the item or report it.",
      details: { name },
    });
  }

  const parsed = registryItemSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    }));
    throw new GraftError({
      code: "REGISTRY_ITEM_INVALID",
      message: `Item "${name}" has an invalid ${MANIFEST_FILE}.`,
      fix: "This is a registry bug — the manifest does not match the item schema (see details.issues). Fix the item or report it.",
      details: { name, issues },
    });
  }
  if (parsed.data.name !== name) {
    throw new GraftError({
      code: "REGISTRY_ITEM_INVALID",
      message: `Item in "${name}/" declares name "${parsed.data.name}" — it must match its directory.`,
      fix: "Rename the directory or the manifest `name` so they agree.",
      details: { name, declared: parsed.data.name },
    });
  }

  return { ...parsed.data, dir };
}

export interface ResolveOptions {
  /** Registry root override (tests point this at a fixture dir). */
  root?: string;
  /** Installed @graft/core version, to gate each item's graftVersion. Skipped if omitted. */
  coreVersion?: string;
}

/**
 * Resolve items plus their `registryDependencies` — transitively, deduped,
 * dependency-first (post-order). Cycles are broken (an item already being
 * visited is skipped). A version mismatch throws REGISTRY_ITEM_INVALID.
 */
export function resolveItems(
  names: readonly string[],
  options: ResolveOptions = {},
): RegistryItem[] {
  const root = options.root ?? registryRoot();
  const resolved: RegistryItem[] = [];
  const done = new Set<string>();
  const visiting = new Set<string>();

  const visit = (name: string): void => {
    if (done.has(name) || visiting.has(name)) return;
    visiting.add(name);
    const item = loadItem(name, root);
    if (options.coreVersion && !satisfies(options.coreVersion, item.graftVersion)) {
      throw new GraftError({
        code: "REGISTRY_ITEM_INVALID",
        message: `Item "${name}" needs @graft/core ${item.graftVersion}, but ${options.coreVersion} is installed.`,
        fix: `Move @graft/core into ${item.graftVersion}, or use a version of "${name}" compatible with ${options.coreVersion}.`,
        details: { name, needs: item.graftVersion, installed: options.coreVersion },
      });
    }
    for (const dep of item.registryDependencies) visit(dep);
    visiting.delete(name);
    done.add(name);
    resolved.push(item);
  };

  for (const name of names) visit(name);
  return resolved;
}

/**
 * The agent-facing description of one item (the `describe_item` MCP shape).
 * Drops the machine-specific absolute `dir` and reduces files to what an agent
 * needs: where they land and their role. `llms` becomes a boolean flag.
 */
export function describeItem(item: RegistryItem): RegistryItemDescriptor {
  return {
    name: item.name,
    type: item.type,
    description: item.description,
    graftVersion: item.graftVersion,
    dependencies: item.dependencies,
    registryDependencies: item.registryDependencies,
    files: item.files.map((file) => ({ target: file.target, role: file.role })),
    llms: item.llms !== undefined,
  };
}

/**
 * Every bundled item as a descriptor, sorted by name — the `list_registry`
 * source. Loads + validates each manifest, so a malformed bundled item surfaces
 * as REGISTRY_ITEM_INVALID here too.
 */
export function listItems(root = registryRoot()): RegistryItemDescriptor[] {
  return listItemNames(root).map((name) => describeItem(loadItem(name, root)));
}
