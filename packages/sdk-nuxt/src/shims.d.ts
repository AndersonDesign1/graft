/**
 * What the runtime imports from a Nuxt app, declared for this package's own
 * typecheck only. In an app, `nuxt/server` and `#imports` are Nuxt's and `#graft/config` is the
 * project's graft.config.ts (the module sets the alias), so the runtime is
 * checked again there against the real types. Not shipped.
 */
declare module "#graft/config" {
  import type { AnyCollection } from "@usegraft/sdk-core";
  import type { AnyGraftFunction } from "@usegraft/core";
  export const collections: Record<string, AnyCollection>;
  export const functions: Record<string, AnyGraftFunction> | undefined;
  export const index: unknown;
  export const contentDir: string | undefined;
}

declare module "nuxt/server" {
  export function useRuntimeConfig(): {
    graft: import("./module").GraftRuntimeConfig;
  };
  export function defineEventHandler<T>(handler: T): T;
}

declare module "#imports" {
  export function useRequestURL(): URL;
  export function useRequestFetch(): (
    path: string,
    options: {
      method: string;
      headers?: HeadersInit;
      responseType: "text";
      ignoreResponseError: true;
      onResponse: (context: { response: Response }) => void;
    },
  ) => Promise<string>;
  export function useAsyncData<T>(
    key: () => string,
    handler: () => Promise<T>,
  ): Promise<{ data: { value: T | undefined } }>;
}
