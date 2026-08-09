/**
 * A deliberately tiny semver check — enough to gate a registry item's
 * `graftVersion` against the installed @usegraft/core, with no dependency.
 *
 * Supported:
 * - "*" / "" / "x"        → any version
 * - space-separated AND of comparators: `>=1.2.0 <2.0.0`, `>1.0.0`, `=1.2.3`, `1.2.3` (exact)
 *
 * Caret/tilde/prerelease ranges are out of scope until an item actually needs
 * them (bundled Tier-1 items use "*" pre-1.0). Unparseable input fails closed.
 */
type Triple = [number, number, number];

export function parseVersion(v: string): Triple | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function compare(a: Triple, b: Triple): number {
  if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
  if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1;
  if (a[2] !== b[2]) return a[2] < b[2] ? -1 : 1;
  return 0;
}

export function satisfies(version: string, range: string): boolean {
  const trimmed = range.trim();
  if (trimmed === "" || trimmed === "*" || trimmed === "x") return true;

  const v = parseVersion(version);
  if (!v) return false;

  for (const comparator of trimmed.split(/\s+/)) {
    const m = /^(>=|<=|>|<|=)?(.+)$/.exec(comparator);
    const target = m ? parseVersion(m[2] ?? "") : null;
    if (!m || !target) return false;
    const cmp = compare(v, target);
    const op = m[1] ?? "=";
    const ok =
      op === ">="
        ? cmp >= 0
        : op === "<="
          ? cmp <= 0
          : op === ">"
            ? cmp > 0
            : op === "<"
              ? cmp < 0
              : cmp === 0;
    if (!ok) return false;
  }
  return true;
}
