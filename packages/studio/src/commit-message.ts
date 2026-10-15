/**
 * The message a commit or publish gets when nobody wrote one: what changed,
 * by the entries' titles. History lists versions by their message, so
 * "Update projects/kyrus-recycling" five times in a row tells nobody
 * anything. Shared by the server, which writes it, and the publish sheet,
 * which shows it as the placeholder, so the two always agree.
 */
export function commitMessageFor(changes: ReadonlyArray<{ kind: string; title: string }>): string {
  const verbs = new Set(
    changes.map((change) =>
      change.kind === "added" ? "Add" : change.kind === "deleted" ? "Delete" : "Update",
    ),
  );
  const verb = verbs.size === 1 ? ([...verbs][0] ?? "Update") : "Update";
  if (changes.length === 0) return "Update content";
  if (changes.length > 3) return `${verb} ${changes.length} entries`;
  const titles = changes.map((change) => `“${change.title}”`);
  const last = titles.pop();
  return titles.length > 0 ? `${verb} ${titles.join(", ")} and ${last}` : `${verb} ${last}`;
}
