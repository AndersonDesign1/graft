"use client";

/**
 * Hero: display type, one CTA pair, and the terminal as the single boxed
 * object — the evidence. The graft figure stands on the terminal's top edge
 * and grows out of it on an endless loop: it is the ambient "alive" signal
 * of the page (no in-view gate — it should be moving whether or not you
 * just arrived).
 */
import type { TermLine } from "../../lib/highlight";
import { INIT_CMD } from "../../lib/install";
import { CopyIcon, copyLabel, useCopy } from "./copy";
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
 * regrows on a 10s period.
 *
 * The endless cycle IS the product story: agents and humans keep making
 * changes, and the content keeps growing out of the terminal.
 */
function GraftFigure() {
  const d = (delay: string) => ({ "--d": delay }) as React.CSSProperties;
  return (
    <div className="graft-figure" aria-hidden="true">
      <svg viewBox="0 0 300 280">
        {/* one continuous stem — rooted on the terminal's top edge, rising in
            a straight up-right diagonal (no elbow; there is space above) */}
        <path
          className="stock drawn"
          pathLength={1}
          d="M50 280 C56 240 70 190 96 148 C118 112 146 84 180 62"
        />

        {/* side branches feather off the stem, heading right */}
        <path
          className="scion drawn"
          pathLength={1}
          style={d("450ms")}
          d="M96 148 C120 140 144 140 166 148"
        />
        <path
          className="scion drawn"
          pathLength={1}
          style={d("700ms")}
          d="M142 91 C164 84 186 84 206 92"
        />

        {/* leaves, base-to-tip along stem and branches */}
        <Leaf at="translate(132 142) rotate(-20) scale(0.75)" delay="900ms" />
        <Leaf at="translate(166 148) rotate(10) scale(0.9)" delay="1000ms" />
        <Leaf at="translate(134 100) rotate(-70) scale(0.8)" delay="1100ms" />
        <Leaf at="translate(175 85) rotate(-30) scale(0.8)" delay="1200ms" />
        <Leaf at="translate(206 92) rotate(-8)" delay="1300ms" />
        <Leaf at="translate(180 62) rotate(-35) scale(1.15)" delay="1400ms" />
      </svg>
    </div>
  );
}

export function Hero({ tagline, terminal }: { tagline?: string; terminal: TermLine[] }) {
  const { copied, copy } = useCopy();
  return (
    <section className="hero-section">
      <div className="hero-copy">
        {/* The hero states the claim; it does not argue it. The argument is
            §02 further down ("Dashboards lock agents out"), which is where a
            reader who wants the reasoning goes looking anyway.

            "agent-native" and not "AI-native": README.md already opens with
            "The agent-native CMS", the term appears across the docs, and
            CONTEXT.md exists to keep one name per thing. A second name for
            this on the front page is how a glossary starts losing. */}
        <h1 className="hero-title">
          The{" "}
          <span className="proof-mark">
            truly agent-native
            <svg viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
              <path pathLength={1} d="M1 7 C 20 3, 45 8.5, 65 5.5 C 80 3.5, 92 6.5, 99 4.5" />
            </svg>
          </span>{" "}
          CMS.
        </h1>
        <p className="hero-sub">
          {tagline ??
            "Most of us already ship with agents more than by hand. Graft keeps content as MDX in git so you and your agent can author, branch, and deploy without living in a panel."}
        </p>
        <div className="hero-actions">
          {/* A button, not a link to #start. It reads as a command, so the
              thing it should do is give you the command — scrolling somebody
              to a section that shows the same string, to copy it there, is a
              detour dressed as a call to action. */}
          <button
            type="button"
            className="button-primary button-copy"
            aria-label={copyLabel(copied, INIT_CMD)}
            onClick={() => copy(INIT_CMD)}
          >
            {INIT_CMD}
            <span className="button-copy-affordance" aria-hidden="true">
              {copied ? "✓" : <CopyIcon />}
            </span>
          </button>
          <a className="button-ghost" href="/why">
            Why Graft
          </a>
        </div>
      </div>
      <div className="hero-stage">
        {/* Anchored inside the stage: bottom: 100% puts the figure's base
            exactly on the terminal's top edge, so it grows out of it. */}
        <GraftFigure />
        <Terminal lines={terminal} />
      </div>
      {/* Margin affordance only — fades on first scroll (Landing.astro). */}
      <p className="scroll-cue" aria-hidden="true">
        scroll
      </p>
    </section>
  );
}
