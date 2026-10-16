/**
 * Recent activity as a person reads it. Saving the same entry five times and
 * committing each is five commits, but one thing that happened: the same
 * person, the same documents, one after another. Those fold into one row that
 * says how many times, dated by the latest.
 */
import type { ActivityEventDto } from "../../editor-types";

export interface ActivityGroup {
  /** The newest of the events folded together. */
  event: ActivityEventDto;
  /** How many events it stands for. */
  times: number;
}

function sameChange(a: ActivityEventDto, b: ActivityEventDto): boolean {
  if (a.by !== b.by || a.byKind !== b.byKind || a.more !== b.more) return false;
  // Events that don't say which documents they changed are only the same
  // when they say the same thing.
  if (a.documents.length === 0 || b.documents.length === 0) {
    return a.documents.length === b.documents.length && a.message === b.message;
  }
  const paths = (event: ActivityEventDto) =>
    event.documents
      .map((doc) => doc.path)
      .sort()
      .join("\n");
  return paths(a) === paths(b);
}

/** Fold runs of the same change by the same person, newest first as given. */
export function groupActivity(events: readonly ActivityEventDto[]): ActivityGroup[] {
  const groups: ActivityGroup[] = [];
  for (const event of events) {
    const last = groups.at(-1);
    if (last && sameChange(last.event, event)) last.times += 1;
    else groups.push({ event, times: 1 });
  }
  return groups;
}
