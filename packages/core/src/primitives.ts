/**
 * mergePrimitives — assemble the collections/functions that a project's `graft/`
 * primitive modules export into one config graph, WITHOUT losing types.
 *
 * `graft add` writes each primitive as an owned module under `graft/` and
 * regenerates a `graft/index.ts` barrel that imports them and calls this. The
 * root `graft.config.ts` merges its own inline collections/functions with the
 * barrel the same way. The result is precisely typed (an intersection of every
 * module's maps), so `Graft<typeof collections>` on the read side keeps full
 * inference — Graft's "no codegen" contract survives the registry. A duplicate
 * key across modules is a CONFIG_INVALID at runtime, never a silent override.
 * (See docs/design-notes/registry.md § Wiring.)
 */
import { GraftError } from "@graft/contracts";
import type { AnyCollection } from "./collection";
import type { AnyGraftFunction } from "./function";

/**
 * What one `graft/` module contributes. The index signature lets an access-only
 * primitive (one that exports helpers but no `collections`/`functions`) still
 * count as a module — its extra exports are simply ignored by the merge.
 */
export interface PrimitiveModule {
  collections?: Record<string, AnyCollection>;
  functions?: Record<string, AnyGraftFunction>;
  [extra: string]: unknown;
}

type UnionToIntersection<U> = (U extends unknown ? (arg: U) => void : never) extends (
  arg: infer I,
) => void
  ? I
  : never;

type CollectionsOf<M> = M extends { collections: infer C extends Record<string, AnyCollection> }
  ? C
  : Record<never, never>;
type FunctionsOf<M> = M extends { functions: infer F extends Record<string, AnyGraftFunction> }
  ? F
  : Record<never, never>;

export interface MergedPrimitives<
  TCollections = Record<string, AnyCollection>,
  TFunctions = Record<string, AnyGraftFunction>,
> {
  collections: TCollections;
  functions: TFunctions;
}

function mergeInto<T>(
  target: Record<string, T>,
  source: Record<string, T> | undefined,
  kind: "collection" | "function",
): void {
  for (const [key, value] of Object.entries(source ?? {})) {
    if (Object.hasOwn(target, key)) {
      throw new GraftError({
        code: "CONFIG_INVALID",
        message: `Duplicate ${kind} "${key}" across graft/ modules.`,
        fix: `Two modules export a ${kind} under \`${kind === "collection" ? "collections" : "functions"}.${key}\`. Rename the key in one of them, then regenerate the barrel with \`graft add\` (or edit graft/index.ts).`,
        details: { kind, key },
      });
    }
    target[key] = value;
  }
}

/**
 * Merge modules left-to-right, rejecting duplicate keys. The value order never
 * affects the result except which duplicate is reported. The return type is the
 * intersection of every module's `collections`/`functions`, so the merged
 * config stays exactly typed.
 */
export function mergePrimitives<const T extends readonly PrimitiveModule[]>(
  modules: T,
): MergedPrimitives<
  UnionToIntersection<CollectionsOf<T[number]>>,
  UnionToIntersection<FunctionsOf<T[number]>>
> {
  const collections: Record<string, AnyCollection> = {};
  const functions: Record<string, AnyGraftFunction> = {};
  for (const mod of modules) {
    mergeInto(collections, mod.collections, "collection");
    mergeInto(functions, mod.functions, "function");
  }
  return { collections, functions } as MergedPrimitives<
    UnionToIntersection<CollectionsOf<T[number]>>,
    UnionToIntersection<FunctionsOf<T[number]>>
  >;
}
