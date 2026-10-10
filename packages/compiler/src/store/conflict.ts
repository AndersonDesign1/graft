import { GraftError } from "@usegraft/contracts";

/** Refuse a write whose caller read a version that is no longer current. */
export function assertBaseVersion(
  path: string,
  baseVersion: string | null | undefined,
  current: string | null,
): void {
  if (baseVersion === undefined || baseVersion === current) return;
  throw new GraftError({
    code: "CONTENT_CONFLICT",
    message:
      current === null
        ? `"${path}" was deleted after it was opened.`
        : baseVersion === null
          ? `"${path}" already exists.`
          : `"${path}" changed after it was opened.`,
    fix: "Read the document again and reapply the change to the current version. Nothing was written.",
    details: { path, baseVersion, currentVersion: current },
  });
}
