/**
 * A line diff of two texts, in the hunk shape the Changes drawer renders.
 *
 * Local Studio asks git for its diff. A hosted Studio has no git binary and
 * no checkout, only the two versions the store returns, so it diffs them
 * itself. Myers' O(ND) algorithm over lines, after trimming the common ends:
 * documents are small, edits are few, and D (the number of changed lines) is
 * what the cost scales with. Past MAX_EDITS it falls back to a plain replace.
 */
import type { DiffHunkDto, DiffLineDto, FileDiffDto } from "../types";

const CONTEXT = 3;
const MAX_LINES = 600;

/** Split on line terminators, CR included, so CRLF files show no stray `\r`. */
function lines(text: string | null): string[] {
  if (text === null || text === "") return [];
  const out = text.split(/\r?\n/);
  if (out[out.length - 1] === "") out.pop();
  return out;
}

type Op = { kind: DiffLineDto["kind"]; text: string; a: number; b: number };

/**
 * Past this many changed lines the minimal diff stops being worth its cost:
 * Myers keeps one frontier per edit, so memory grows with the square of the
 * edit count. The fallback (every old line removed, every new line added) is
 * still a correct diff, just not the shortest.
 */
const MAX_EDITS = 2000;

/** Edit script from a to b. Common ends are cheap, so only the middle pays for Myers. */
function editScript(a: string[], b: string[]): Op[] {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail += 1;
  }

  const ops: Op[] = [];
  for (let i = 0; i < head; i += 1) ops.push({ kind: "context", text: a[i] as string, a: i, b: i });
  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);
  const middle = myers(midA, midB) ?? replaceAll(midA, midB);
  for (const op of middle) ops.push({ ...op, a: op.a + head, b: op.b + head });
  for (let i = tail; i > 0; i -= 1) {
    ops.push({
      kind: "context",
      text: a[a.length - i] as string,
      a: a.length - i,
      b: b.length - i,
    });
  }
  return ops;
}

function replaceAll(a: string[], b: string[]): Op[] {
  return [
    ...a.map((text, i): Op => ({ kind: "remove", text, a: i, b: 0 })),
    ...b.map((text, j): Op => ({ kind: "add", text, a: a.length, b: j })),
  ];
}

/**
 * Myers with a trace, then backtrack. Each step keeps only the band of the
 * frontier that step can touch (2d + 3 entries), not the whole array, and
 * the search gives up past MAX_EDITS: null means "use the fallback".
 */
function myers(a: string[], b: string[]): Op[] | null {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  outer: for (let d = 0; d <= max; d += 1) {
    if (d > MAX_EDITS) return null;
    // Step d reads k - 1 and k + 1 for k in [-d, d]: keep [-d - 1, d + 1].
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && (v[offset + k - 1] as number) < (v[offset + k + 1] as number))
          ? (v[offset + k + 1] as number)
          : (v[offset + k - 1] as number) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) break outer;
    }
  }

  const ops: Op[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d -= 1) {
    const vd = trace[d] as Int32Array;
    const band = d + 1; // index of k = 0 in this step's slice
    const k = x - y;
    const prevK =
      k === -d || (k !== d && (vd[band + k - 1] as number) < (vd[band + k + 1] as number))
        ? k + 1
        : k - 1;
    const prevX = vd[band + prevK] as number;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x -= 1;
      y -= 1;
      ops.push({ kind: "context", text: a[x] as string, a: x, b: y });
    }
    if (d > 0) {
      if (x === prevX) {
        y -= 1;
        ops.push({ kind: "add", text: b[y] as string, a: x, b: y });
      } else {
        x -= 1;
        ops.push({ kind: "remove", text: a[x] as string, a: x, b: y });
      }
    }
  }
  return ops.reverse();
}

export function lineDiff(path: string, before: string | null, after: string | null): FileDiffDto {
  const ops = editScript(lines(before), lines(after));
  const changed = ops.map((op, i) => (op.kind === "context" ? -1 : i)).filter((i) => i >= 0);
  const hunks: DiffHunkDto[] = [];
  let added = 0;
  let removed = 0;
  let rendered = 0;
  let truncated = false;

  let i = 0;
  while (i < changed.length) {
    const start = Math.max(0, (changed[i] as number) - CONTEXT);
    let end = Math.min(ops.length - 1, (changed[i] as number) + CONTEXT);
    while (i + 1 < changed.length && (changed[i + 1] as number) - CONTEXT <= end + 1) {
      i += 1;
      end = Math.min(ops.length - 1, (changed[i] as number) + CONTEXT);
    }
    i += 1;

    const slice = ops.slice(start, end + 1);
    const first = slice[0] as Op;
    const oldLines = slice.filter((op) => op.kind !== "add").length;
    const newLines = slice.filter((op) => op.kind !== "remove").length;
    const hunk: DiffHunkDto = {
      heading: "",
      // An empty side starts at the line before it, as in git (`-0,0` for a new file).
      oldStart: oldLines === 0 ? first.a : first.a + 1,
      newStart: newLines === 0 ? first.b : first.b + 1,
      oldLines,
      newLines,
      lines: [],
    };
    for (const op of slice) {
      if (op.kind === "add") added += 1;
      if (op.kind === "remove") removed += 1;
      if (rendered >= MAX_LINES) {
        truncated = true;
        continue;
      }
      rendered += 1;
      hunk.lines.push({
        kind: op.kind,
        text: op.text,
        ...(op.kind !== "add" ? { oldLine: op.a + 1 } : {}),
        ...(op.kind !== "remove" ? { newLine: op.b + 1 } : {}),
      });
    }
    if (hunk.lines.length > 0) hunks.push(hunk);
  }

  return { path, binary: false, hunks, added, removed, truncated };
}
