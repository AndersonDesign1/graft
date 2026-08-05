/**
 * Bundle the Studio SPA into dist/ui (HTML + CSS + JS).
 */
import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "dist", "ui");

mkdirSync(outDir, { recursive: true });
cpSync(join(root, "src", "ui", "index.html"), join(outDir, "index.html"));
cpSync(join(root, "src", "ui", "tokens.css"), join(outDir, "tokens.css"));
cpSync(join(root, "src", "ui", "studio.css"), join(outDir, "studio.css"));

await esbuild.build({
  entryPoints: [join(root, "src", "ui", "main.tsx")],
  outfile: join(outDir, "studio.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2022"],
  jsx: "automatic",
  minify: true,
  logLevel: "info",
});

console.log("studio ui → dist/ui");
