/** Presentation helpers. Numbers are rendered tabular in CSS, not here. */

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["second", 60],
  ["minute", 60],
  ["hour", 24],
  ["day", 7],
  ["week", 4.348],
  ["month", 12],
  ["year", Number.POSITIVE_INFINITY],
];

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "narrow" });

/** "2m ago", "3d ago" — the timestamp format an operator actually scans. */
export function relativeTime(iso: string | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  let delta = (then - Date.now()) / 1000;
  for (const [unit, span] of UNITS) {
    if (Math.abs(delta) < span) return rtf.format(Math.round(delta), unit);
    delta /= span;
  }
  return rtf.format(Math.round(delta), "year");
}

export function absoluteTime(iso: string | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

export const shortSha = (sha: string | null | undefined): string => (sha ? sha.slice(0, 7) : "");

export const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`;
