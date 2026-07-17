"use client";

/**
 * Hero: display type, one CTA pair, and the terminal as the single boxed
 * object — the evidence. The graft figure stands on the terminal's top edge
 * and grows out of it on load; afterwards the sway and the union pulse are
 * the ambient "alive" signal of the page (no in-view gate — it should be
 * moving whether or not you just arrived).
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
 * The graft, rooted in the terminal. The figure stands ON the terminal's top
 * edge — root grips hold the frame, the rootstock climbs to the union, and
 * only the scion leafs out above it (that is the point of a graft). Things
 * that grow need somewhere to grow *from*, and here that somewhere is the
 * live evidence itself. It grows once — plants do not retract — and then the
 * living signal is the sway and the union's pulse.
 */
function GraftFigure() {
  const d = (delay: string) => ({ "--d": delay }) as React.CSSProperties;
  return (
    <div className="graft-figure" aria-hidden="true">
      <svg viewBox="0 0 320 380">
        {/* root grips: the stock holds the terminal's top edge */}
        <path className="stock drawn" pathLength={1} style={d("120ms")} d="M150 378 C132 377 114 380 92 373" />
        <path className="stock drawn" pathLength={1} style={d("220ms")} d="M150 378 C168 376 186 379 210 372" />

        {/* rootstock: the repo the graft takes on */}
        <path
          className="stock drawn"
          pathLength={1}
          d="M150 380 C148 344 140 316 144 284 C147 262 144 250 142 234"
        />

        {/* scion: grafted above the union, branching as it climbs */}
        <path
          className="scion drawn"
          pathLength={1}
          style={d("650ms")}
          d="M142 234 C140 204 152 176 172 152 C190 130 214 114 242 102"
        />
        <path className="scion drawn" pathLength={1} style={d("1050ms")} d="M147 193 C136 184 128 174 124 160" />
        <path className="scion drawn" pathLength={1} style={d("1150ms")} d="M172 152 C186 148 198 150 210 144" />
        <path className="scion drawn" pathLength={1} style={d("1250ms")} d="M196 122 C204 110 206 100 204 88" />

        {/* leaves — only above the union */}
        <Leaf at="translate(124 160) rotate(-115)" delay="1450ms" />
        <Leaf at="translate(210 144) rotate(-20)" delay="1550ms" />
        <Leaf at="translate(204 88) rotate(-90)" delay="1650ms" />
        <Leaf at="translate(242 102) rotate(-58) scale(1.15)" delay="1750ms" />
        <Leaf at="translate(242 102) rotate(2) scale(0.85)" delay="1850ms" />

        {/* the union — where the cambium lines up */}
        <circle className="union-ring" cx="142" cy="234" r="11" />
        <circle className="union" cx="142" cy="234" r="5" />
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
