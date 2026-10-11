import { toast } from "sonner";
import type { ContentChangeNotice } from "@usegraft/compiler";

/**
 * Warn when a write landed but the site was not told to refresh.
 *
 * Without this the editor sees "Saved", opens the site, and finds the old
 * copy with nothing to say why. The fixed id keeps an autosaving editor from
 * stacking one warning per pause in typing.
 */
export function warnIfNotRefreshed(refresh: ContentChangeNotice | undefined): void {
  if (!refresh || refresh.ok) return;
  toast.warning("Saved, but the site was not refreshed", {
    id: "content-refresh-failed",
    description: refresh.fix ?? refresh.message,
  });
}
