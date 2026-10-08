/**
 * Open Graph cards for doc pages: 1200×630 PNGs, built once at prerender.
 *
 * satori lays the card out and draws text as vector paths from the font file
 * itself, so the result does not depend on which fonts the build machine has
 * installed. sharp turns that SVG into the PNG social sites require (none of
 * them accept SVG for og:image).
 *
 * Colors are the dark-scheme token values from @usegraft/tokens, written out
 * because satori cannot resolve CSS variables.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createElement, type CSSProperties, type ReactNode } from "react";
import satori from "satori";
import sharp from "sharp";

const require = createRequire(import.meta.url);
const font = (weight: 400 | 600): Buffer =>
  readFileSync(
    require.resolve(`@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-${weight}-normal.woff`),
  );

const INK = "#f2f2ef"; // --n-9
const MUTED = "#d1d1cf"; // --n-8
const FAINT = "#bcbcb9"; // --n-7
const STAGE = "#000000"; // --n-0

const el = (type: string, style: CSSProperties, children?: ReactNode | ReactNode[]): ReactNode =>
  createElement(type, { style }, children);

export async function renderOgCard(card: {
  title: string;
  description: string;
  section: string;
}): Promise<Buffer> {
  const svg = await satori(
    el(
      "div",
      {
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "72px 80px",
        background: STAGE,
        color: INK,
        fontFamily: "Plex",
      },
      [
        el("div", { display: "flex", fontSize: 30, fontWeight: 600, color: INK }, "graft. docs"),
        el("div", { display: "flex", flexDirection: "column", gap: 24 }, [
          el("div", { display: "flex", fontSize: 26, color: FAINT }, card.section),
          el(
            "div",
            { display: "flex", fontSize: 76, fontWeight: 600, lineHeight: 1.08, letterSpacing: -2 },
            card.title,
          ),
          el(
            "div",
            { display: "flex", fontSize: 32, lineHeight: 1.35, color: MUTED, maxWidth: 980 },
            card.description,
          ),
        ]),
        el("div", { display: "flex", fontSize: 24, color: FAINT }, "graft.page/docs"),
      ],
    ),
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: "Plex", data: font(400), weight: 400, style: "normal" },
        { name: "Plex", data: font(600), weight: 600, style: "normal" },
      ],
    },
  );
  return sharp(Buffer.from(svg)).png().toBuffer();
}
