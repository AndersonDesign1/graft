"use client";

/**
 * Branching — one frame, four beats.
 *
 * Quiet text tabs across the top; copy on the left; a typewriter terminal on
 * the right that types the command then drops the response. Auto-advances
 * while in view; hover/focus pauses; a click selects. No secondary deck —
 * the CLI output is the model.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useInView } from "./reveal";

type Step = 0 | 1 | 2 | 3;

interface TermBit {
  kind: "cmd" | "out" | "dim" | "ok";
  text: string;
}

interface Tab {
  id: string;
  label: string;
  title: string;
  body: ReactNode;
  lines: TermBit[];
}

const TABS: Tab[] = [
  {
    id: "create",
    label: "Create",
    title: "A registry row. Nothing copied.",
    body: (
      <>
        A branch is an edge off <code>main</code>. Instant and isolated. Reads fall through the
        overlay until something writes.
      </>
    ),
    lines: [
      { kind: "cmd", text: "$ graft branch create preview" },
      { kind: "ok", text: 'Created branch "preview" from "main"' },
      { kind: "dim", text: "overlay — zero rows copied" },
      { kind: "out", text: "Reads overlay the parent until the branch writes." },
    ],
  },
  {
    id: "edit",
    label: "Edit",
    title: "Compile on the branch.",
    body: (
      <>
        Compile writes an overlay row. The leaf shadows the parent. <code>main</code> stays
        untouched.
      </>
    ),
    lines: [
      { kind: "cmd", text: "$ graft compile --branch preview" },
      { kind: "ok", text: "pages/pricing     validated ✓" },
      { kind: "out", text: "projected to content_index @ preview" },
      { kind: "dim", text: "+0 added  ~1 changed  −0 removed" },
    ],
  },
  {
    id: "tombstone",
    label: "Tombstone",
    title: "Hide without touching main.",
    body: (
      <>
        A tombstone hides the parent row on this branch only. <code>main</code>&apos;s changelog is
        still there.
      </>
    ),
    lines: [
      { kind: "cmd", text: "$ # via MCP write / delete_content" },
      { kind: "out", text: 'delete_content({ slug: "changelog" })' },
      { kind: "ok", text: "tombstone written on preview" },
      { kind: "dim", text: "main.changelog still intact" },
    ],
  },
  {
    id: "merge",
    label: "Merge",
    title: "Dry-run first. Then land it.",
    body: (
      <>
        Content recompiles from the git merge; data rows move; the branch drops. <code>main</code>{" "}
        carries the new pricing, minus the tombstoned changelog.
      </>
    ),
    lines: [
      { kind: "cmd", text: "$ graft merge preview --apply" },
      { kind: "out", text: "Ledger: replaying 2 data_records onto main" },
      { kind: "ok", text: "would recompile working tree → main" },
      { kind: "dim", text: 'branch "preview" dropped' },
    ],
  },
];

/** Long enough for the typewriter to finish before the next beat. */
const DWELL_MS = 7200;

/** Color the `$` prompt and quoted strings inside a terminal line. */
function paintLine(text: string, kind: TermBit["kind"]) {
  if (kind === "cmd" && text.startsWith("$")) {
    return (
      <>
        <span className="tline-prompt">$</span>
        {paintStrings(text.slice(1))}
      </>
    );
  }
  if (kind === "out" || kind === "ok") return paintStrings(text);
  return text;
}

function paintStrings(text: string) {
  const parts = text.split(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    part.startsWith('"') || part.startsWith("'") ? (
      <span key={i} className="tline-str">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

/**
 * Types the command, then drops response lines one by one.
 * Remounts (via key) whenever the active tab changes.
 */
function BranchTerminal({ lines }: { lines: TermBit[] }) {
  const [row, setRow] = useState(0);
  const [chars, setChars] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reduced = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  useEffect(() => {
    if (reduced) {
      setRow(lines.length);
      return;
    }
    if (row >= lines.length) return;

    const line = lines[row]!;
    const isCmd = line.kind === "cmd";
    const full = line.text.length;
    const doneTyping = !isCmd || chars >= full;

    timer.current = setTimeout(
      () => {
        if (doneTyping) {
          setRow((r) => r + 1);
          setChars(0);
        } else {
          setChars((c) => c + 1);
        }
      },
      doneTyping ? (isCmd ? 280 : 380) : 28 + Math.random() * 32,
    );
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [row, chars, reduced, lines]);

  const done = row >= lines.length;
  const current = done ? null : lines[row]!;
  const typingCmd = current?.kind === "cmd";

  return (
    <div className="terminal branch-terminal">
      <div className="terminal-bar">
        <span className="terminal-traffic" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="terminal-title">Terminal</span>
      </div>
      <pre className="terminal-body" aria-live="polite">
        {lines.slice(0, row).map((line, i) => (
          <span key={i} className={`tline tline-${line.kind}`}>
            {paintLine(line.text, line.kind)}
            {"\n"}
          </span>
        ))}
        {typingCmd ? (
          <span className="tline tline-cmd">
            {paintLine(current.text.slice(0, chars), "cmd")}
            <span className="caret" aria-hidden="true" />
          </span>
        ) : null}
        {!done && !typingCmd ? <span className="caret" aria-hidden="true" /> : null}
        {done ? <span className="caret" aria-hidden="true" /> : null}
      </pre>
    </div>
  );
}

export function BranchingDemo() {
  const { ref, inView } = useInView<HTMLDivElement>("0px", 0.35);
  const [active, setActive] = useState<Step>(0);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const reduced = useRef(
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    if (!inView || paused || reduced.current) {
      setProgress(0);
      return;
    }
    const started = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = (now - started) / DWELL_MS;
      if (t >= 1) {
        setActive((s) => ((s + 1) % TABS.length) as Step);
        setProgress(0);
        return;
      }
      setProgress(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, paused, active]);

  const select = useCallback((i: Step) => {
    setActive(i);
    setProgress(0);
  }, []);

  const tab = TABS[active]!;

  return (
    <div
      ref={ref}
      className="branch-stage"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setPaused(false);
      }}
    >
      <div className="branch-tabs" role="tablist" aria-label="Branching steps">
        {TABS.map((t, i) => {
          const selected = active === i;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`branch-tab-${t.id}`}
              aria-selected={selected}
              aria-controls="branch-panel"
              className="branch-tab"
              data-active={selected}
              onClick={() => select(i as Step)}
            >
              <span className="branch-tab-n" aria-hidden="true">
                0{i + 1}
              </span>
              <span className="branch-tab-label">{t.label}</span>
              {selected && !reduced.current ? (
                <span
                  className="branch-tab-progress"
                  style={{ "--p": progress } as CSSProperties}
                  aria-hidden="true"
                />
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="branch-body">
        <div
          className="branch-copy"
          id="branch-panel"
          role="tabpanel"
          aria-labelledby={`branch-tab-${tab.id}`}
        >
          <h3>{tab.title}</h3>
          <p className="branch-copy-body">{tab.body}</p>
        </div>

        <div className="branch-term">
          <BranchTerminal key={tab.id} lines={tab.lines} />
        </div>
      </div>
    </div>
  );
}
