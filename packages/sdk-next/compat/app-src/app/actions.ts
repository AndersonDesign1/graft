"use server";

import { updateContent } from "@usegraft/sdk-next";

/**
 * Refresh the home page's tags from inside a Server Action, the one place
 * Next 16 allows `updateTag`. On 14 and 15 `updateContent` refuses with a
 * GraftError instead, and the code comes back so the smoke test can check it.
 */
export async function refreshHome() {
  try {
    const tags = updateContent("main", {
      added: [],
      changed: ["pages/home"],
      removed: [],
      unchanged: 0,
    });
    return { ok: true, tags };
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    return { ok: false, code: typeof code === "string" ? code : String(error) };
  }
}
