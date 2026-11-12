#!/usr/bin/env node
/**
 * Put a static copy of Studio in `public/studio-demo/` for the landing
 * previews under `/lab`.
 *
 * It copies the built Studio bundle (`packages/studio/dist/ui`), adds the
 * recorded API responses and the script that replays them
 * (`src/studio-demo/`), and loads that script before the app. The output is
 * generated and ignored by Git.
 *
 * When Studio has not been built, this prints how to build it and exits 0:
 * the previews then show the Studio screenshot they already use as a poster.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const site = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundle = join(site, "..", "..", "packages", "studio", "dist", "ui");
const source = join(site, "src", "studio-demo");
const out = join(site, "public", "studio-demo");

if (!existsSync(join(bundle, "index.html"))) {
  console.log(
    "studio-demo: packages/studio/dist/ui is missing, so the previews show a screenshot.\n" +
      "  Build it with: pnpm --filter @usegraft/studio... run build",
  );
  process.exit(0);
}

// Copy over the old output instead of deleting the folder first: a running
// dev server stops serving a public folder that is removed and recreated.
// Only the hashed assets a newer bundle no longer has are cleared.
mkdirSync(join(out, "assets"), { recursive: true });
const current = new Set(readdirSync(join(bundle, "assets")));
for (const file of readdirSync(join(out, "assets"))) {
  if (!current.has(file)) rmSync(join(out, "assets", file));
}
cpSync(bundle, out, { recursive: true });
cpSync(join(source, "shim.js"), join(out, "demo-shim.js"));
// The recorded responses are kept gzipped: 1.3 MB of JSON as 290 KB.
writeFileSync(
  join(out, "demo-fixtures.json"),
  gunzipSync(readFileSync(join(source, "fixtures.json.gz"))),
);

const marker = '<script type="module"';
const html = readFileSync(join(out, "index.html"), "utf8");
if (!html.includes(marker)) {
  console.error("studio-demo: Studio's index.html has no module script to load the demo before.");
  process.exit(1);
}
writeFileSync(
  join(out, "index.html"),
  html.replace(marker, `<script src="./demo-shim.js"></script>\n    ${marker}`),
);
console.log("studio-demo: wrote public/studio-demo/");
