/**
 * A line diff of two texts, in the hunk shape the Changes drawer renders.
 *
 * Local Studio asks git for its diff. A hosted Studio has no git binary and
 * no checkout, only the two versions the store returns, so it diffs them
 * itself. Myers' O(ND) algorithm over lines: documents are small, edits are
 * few, and D (the number of changed lines) is what the cost scales with.
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

/** Edit script from a to b: Myers with a trace, then backtrack. */
function editScript(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  outer: for (let d = 0; d <= max; d += 1) {
    trace.push(v.slice());
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
    const k = x - y;
    const prevK =
      k === -d || (k !== d && (vd[offset + k - 1] as number) < (vd[offset + k + 1] as number))
        ? k + 1
        : k - 1;
    const prevX = vd[offset + prevK] as number;
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
    const hunk: DiffHunkDto = {
      heading: "",
      oldStart: first.a + 1,
      newStart: first.b + 1,
      oldLines: slice.filter((op) => op.kind !== "add").length,
      newLines: slice.filter((op) => op.kind !== "remove").length,
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
