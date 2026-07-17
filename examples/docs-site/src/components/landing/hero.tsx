"use client";

/**
 * Hero: display type, one CTA pair, and the terminal as the single boxed
 * object — the evidence. The graft figure stands on the terminal's top edge
 * and grows out of it on an endless loop: it is the ambient "alive" signal
 * of the page (no in-view gate — it should be moving whether or not you
 * just arrived).
 */
import type { TermLine } from "../../lib/highlight";
import { Terminal } from "./terminal";

/** The classic leaf silhouette, drawn once; each instance is placed and
 *  angled by its parent <g>. The base of the leaf is the local origin, so the
 *  pop animation scales it out of its own stem. */
const LEAF = "M0 0 C7 -12 22 -16 32 -8 C26 4 10 8 0 0 Z";

function Leaf({ at, delay }: { at: string; delay: string }) {
  return (
    <g transform={at}>
      <path className="leaf" d={LEAF} style={{ "--d": delay } as React.CSSProperties} />
    </g>
  );
}

/**
 * The graft, rooted in the terminal. A single stick stands ON the terminal's
 * top edge at its far right end, and the branches sweep RIGHT into the open
 * space beside the type — never over it. The growth is endless: branches draw
 * in as a wave, the leaves unfurl, everything holds, retracts tip-first, and
 * regrows (same 10s period as the loop circuit further down the page).
 */
function GraftFigure() {
  const d = (delay: string) => ({ "--d": delay }) as React.CSSProperties;
  return (
    <div className="graft-figure" aria-hidden="true">
      <svg viewBox="0 0 300 280">
        {/* the stick — rooted on the terminal's top edge */}
        <path className="stock drawn" pathLength={1} d="M50 280 C52 250 46 224 58 190" />

        {/* branches sweep right, into the empty space */}
        <path
          className="scion drawn"
          pathLength={1}
          style={d("300ms")}
          d="M58 190 C70 160 96 142 130 134 C168 125 210 126 246 138"
        />
        <path className="scion drawn" pathLength={1} style={d("600ms")} d="M130 134 C140 112 158 98 184 92" />
        <path className="scion drawn" pathLength={1} style={d("750ms")} d="M94 148 C118 150 148 158 166 172" />

        {/* leaves, base-to-tip along the branches */}
        <Leaf at="translate(151 107) rotate(-55) scale(0.85)" delay="900ms" />
        <Leaf at="translate(184 92) rotate(-20)" delay="1000ms" />
        <Leaf at="translate(189 128) rotate(-25) scale(0.9)" delay="1100ms" />
        <Leaf at="translate(246 138) rotate(5) scale(1.15)" delay="1200ms" />
        <Leaf at="translate(166 172) rotate(30) scale(0.85)" delay="1300ms" />
      </svg>
    </div>
  );
}

export function Hero({ tagline, terminal }: { tagline?: string; terminal: TermLine[] }) {
  return (
    <section className="hero-section">
      <div className="hero-copy">
        <h1 className="hero-title">
          Content is code.{" "}
          <span className="proof-mark">
            Agents operate it.
            <svg viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
              <path pathLength={1} d="M1 7 C 20 3, 45 8.5, 65 5.5 C 80 3.5, 92 6.5, 99 4.5" />
            </svg>
          </span>
        </h1>
        <p className="hero-sub">
          {tagline ??
            "Graft is the CMS that grafts onto your repo: MDX in git, a Zod schema, a Postgres index — and every error teaches the agent its own fix."}
        </p>
        <div className="hero-actions">
          <a className="button-primary" href="#start">
            pnpm graft init
          </a>
          <a className="button-ghost" href="/how-it-works">
            How it works
          </a>
        </div>
      </div>
      <div className="hero-stage">
        {/* Anchored inside the stage: bottom: 100% puts the figure's base
            exactly on the terminal's top edge, so it grows out of it. */}
        <GraftFigure />
        <Terminal lines={terminal} />
      </div>
    </section>
  );
}
