// Make a copy of the built /lab pages that works from any folder: every
// absolute path becomes relative, and links off the previews go to graft.page.
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";

const [src, out] = process.argv.slice(2);
rmSync(out, { recursive: true, force: true });
const put = (rel, data) => { const to = join(out, rel); mkdirSync(dirname(to), { recursive: true }); writeFileSync(to, data); };
const copy = (rel) => { const to = join(out, rel); mkdirSync(dirname(to), { recursive: true }); cpSync(join(src, rel), to); };

const pages = ["lab/index.html", ...["landing", "a", "b", "c", "map"].map((p) => `lab/${p}/index.html`)];
for (const page of pages) {
  const up = "../".repeat(page.split("/").length - 1);
  let html = readFileSync(join(src, page), "utf8");
  html = html.replace(/\b(href|src|data-demo)="\/([^"/][^"]*|)"/g, (_, attr, path) => {
    if (path === "lab") return `${attr}="${up}lab/index.html"`;
    const lab = path.match(/^lab\/(landing|a|b|c|map)$/);
    if (lab) return `${attr}="${up}lab/${lab[1]}/index.html"`;
    // The host reserves names that start with "_", so Astro's folder is renamed.
    if (path.startsWith("_astro/")) return `${attr}="${up}${path.replace("_astro/", "site-assets/")}"`;
    if (/^(agents|lab|studio-demo|favicon)/.test(path)) return `${attr}="${up}${path}"`;
    return `${attr}="https://graft.page/${path}"`;
  });
  put(page, html);
}
for (const file of readdirSync(join(src, "_astro"))) {
  if (file.endsWith(".woff")) continue;
  if (file.endsWith(".css")) put(`site-assets/${file}`, readFileSync(join(src, "_astro", file), "utf8").replaceAll("url(/_astro/", "url(./"));
  else if (file.endsWith(".woff2") || /^page\./.test(file)) { const to = join(out, "site-assets", file); mkdirSync(dirname(to), { recursive: true }); cpSync(join(src, "_astro", file), to); }
}
for (const file of readdirSync(join(src, "agents"))) copy(`agents/${file}`);
copy("favicon.svg"); copy("lab/studio-dark.jpg"); copy("lab/studio-light.jpg");
for (const file of ["index.html", "demo-shim.js", "demo-fixtures.json"]) copy(`studio-demo/${file}`);
for (const file of readdirSync(join(src, "studio-demo/assets"))) {
  if (file.endsWith(".ttf") || file.endsWith(".woff")) continue;
  copy(`studio-demo/assets/${file}`);
}
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
const all = walk(out).map((f) => f.slice(out.length + 1));
const size = all.reduce((n, f) => n + statSync(join(out, f)).size, 0);
writeFileSync(join(out, "..", "files-site.json"), JSON.stringify(all.filter((f) => !f.startsWith("studio-demo/"))));
writeFileSync(join(out, "..", "files-studio.json"), JSON.stringify(all.filter((f) => f.startsWith("studio-demo/"))));
console.log(all.length, "files", (size / 1e6).toFixed(1), "MB; site", all.filter((f) => !f.startsWith("studio-demo/")).length, "studio", all.filter((f) => f.startsWith("studio-demo/")).length);
