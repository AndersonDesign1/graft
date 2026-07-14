"use client";

/**
 * Hero: display type, one CTA pair, and the terminal as the single boxed
 * object — the evidence. The graft drawing lives off to the side and runs on a
 * loop (no in-view gate): it is the ambient "alive" signal of the page, so it
 * should be moving whether or not you just arrived.
 */
import type { TermLine } from "../../lib/highlight";
import { Terminal } from "./terminal";

/**
 * The graft, rooted. The rootstock enters from the bottom edge of the hero and
 * climbs; the union sits mid-canvas; the scion branches off the top-right and
 * deliberately leaves the canvas. It is the landscape the type stands in, not
 * an illustration parked beside it — so it is anchored to an edge (things that
 * grow have somewhere to grow *from*) and it runs off the frame rather than
 * being politely contained.
 */
function GraftFigure() {
  return (
    <div className="graft-figure" aria-hidden="true">
      <svg viewBox="0 0 600 620" preserveAspectRatio="xMaxYMax meet">
        {/* rootstock: your repo — enters from the bottom edge */}
        <path
          className="stock drawn"
          pathLength={1}
          d="M200 620 C206 522 214 458 246 398 C276 342 302 312 320 268"
        />
        <path
          className="stock drawn"
          pathLength={1}
          d="M200 620 C186 558 162 528 118 502"
          opacity="0.55"
        />
        <path
          className="stock drawn"
          pathLength={1}
          d="M214 560 C238 542 262 534 296 530"
          opacity="0.4"
        />

        {/* scion: graft — runs off the top-right of the canvas on purpose.
            The paths overshoot the viewBox; the svg is overflow: visible, so
            they carry on past the frame instead of stopping politely at it. */}
        <path
          className="scion drawn late"
          pathLength={1}
          d="M320 268 C384 238 432 190 472 120 C500 68 536 26 610 -26"
        />
        <path
          className="scion drawn late"
          pathLength={1}
          d="M432 190 C480 204 530 198 620 168"
          opacity="0.65"
        />
        <path
          className="scion drawn late"
          pathLength={1}
          d="M398 222 C414 262 424 300 428 344"
          opacity="0.5"
        />
        <path
          className="scion drawn late"
          pathLength={1}
          d="M472 120 C508 136 548 132 616 112"
          opacity="0.45"
        />

        {/* the union — where the cambium lines up */}
        <circle className="union-ring" cx="320" cy="268" r="11" />
        <circle className="union" cx="320" cy="268" r="6" />
      </svg>
    </div>
  );
}

export function Hero({ tagline, terminal }: { tagline?: string; terminal: TermLine[] }) {
  return (
    <section className="hero-section">
      {/* The figure roots to the bottom of the copy block — i.e. it grows up
          out of the terminal's top edge. Anchoring it to the section instead
          put the trunk *behind* the opaque terminal, which chopped the plant
          into two disconnected fragments. */}
      <div className="hero-copy">
        <GraftFigure />
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
        <Terminal lines={terminal} />
      </div>
    </section>
  );
}
