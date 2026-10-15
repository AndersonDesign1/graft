/**
 * Measure Studio on a large catalog, the same way every time.
 *
 *   pnpm bench                           # 2,000 products, 5 runs, a throwaway Postgres
 *   pnpm bench --count 500 --runs 9
 *   pnpm bench --db postgres://…         # an existing, disposable database
 *   pnpm bench --sizes                   # Studio's bundle only: no seed, no database
 *
 * It copies this example into a temporary directory, seeds it there with
 * `scripts/seed.mjs --count <n>`, commits the result to a fresh Git
 * repository, and drives the CLI and Studio API from this checkout. Nothing
 * under examples/shop changes, and Publish commits only to the copy.
 *
 * It never reads DATABASE_URL from the environment: without --db it starts a
 * throwaway PostgreSQL with the graft-verify skill's pg.sh and stops it at the
 * end. Build first (`pnpm -r --filter @usegraft/cli... run build`), since it
 * runs packages/cli/dist and serves packages/studio/dist/ui.
 *
 * Prints one Markdown table of medians, ready to paste.
 */
import { execFileSync, spawn } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const shop = fileURLToPath(new URL("..", import.meta.url));
const repo = join(shop, "..", "..");
const cli = join(repo, "packages", "cli", "dist", "index.js");
const ui = join(repo, "packages", "studio", "dist", "ui");
const pgScript = join(repo, ".agents", "skills", "graft-verify", "scripts", "pg.sh");

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : process.argv[at + 1];
};
const count = Number(arg("count", 2000));
const runs = Number(arg("runs", 5));
const keep = process.argv.includes("--keep");
if (!Number.isInteger(count) || count < 1) throw new Error("--count needs a whole number");
if (!Number.isInteger(runs) || runs < 1) throw new Error("--runs needs a whole number");
for (const built of [cli, join(ui, "index.html")]) {
  try {
    statSync(built);
  } catch {
    throw new Error(
      `${built} is missing. Build first: pnpm -r --filter @usegraft/cli... run build`,
    );
  }
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const time = async (fn) => {
  const start = performance.now();
  await fn();
  return performance.now() - start;
};
const freePort = () =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

const rows = [];
const record = (metric, samples, unit = "ms") => {
  rows.push({ metric, samples, unit });
  console.error(`  ${metric}: ${samples.map((s) => s.toFixed(0)).join(", ")} ${unit}`);
};

// --sizes: only the bundle, which needs a build and nothing else.
if (!process.argv.includes("--sizes")) await measure();

async function measure() {
  /* ---- the project ------------------------------------------------------- */

  const dir = mkdtempSync(join(tmpdir(), "graft-bench-"));
  for (const name of ["graft.config.ts", "graft", "scripts", "package.json", "tsconfig.json"]) {
    cpSync(join(shop, name), join(dir, name), { recursive: true });
  }
  symlinkSync(join(shop, "node_modules"), join(dir, "node_modules"), "dir");
  execFileSync(process.execPath, [join(dir, "scripts", "seed.mjs"), "--count", String(count)], {
    stdio: "inherit",
  });
  const sh = (cmd, args) => execFileSync(cmd, args, { cwd: dir, encoding: "utf8" });
  sh("git", ["init", "--quiet", "--initial-branch=main"]);
  sh("git", ["config", "user.name", "Graft Bench"]);
  sh("git", ["config", "user.email", "bench@example.com"]);
  sh("git", ["add", "."]);
  sh("git", ["commit", "--quiet", "-m", "Seed the catalog"]);

  let databaseUrl = arg("db");
  const pgDir = join(dir, "pg");
  if (!databaseUrl) databaseUrl = sh("bash", [pgScript, "up", pgDir]).trim();

  // Only the bench's own database, whatever the calling shell exports.
  const env = { ...process.env, DATABASE_URL: databaseUrl, GRAFT_REVALIDATE_URL: "" };
  for (const name of Object.keys(env)) {
    if (/NEON|^S3_|^AWS_|^R2_|GITHUB_TOKEN|GH_TOKEN|^GRAFT_GITHUB_|^GRAFT_STUDIO_/.test(name)) {
      delete env[name];
    }
  }
  const graft = (...args) =>
    execFileSync(process.execPath, [cli, ...args], { cwd: dir, env, encoding: "utf8" });

  let studio;
  try {
    graft("db", "migrate");

    /* ---- compile --------------------------------------------------------- */

    console.error("compile");
    record("`graft compile`, empty index", [await time(() => graft("compile"))]);
    const compiles = [];
    for (let i = 0; i < runs; i += 1) compiles.push(await time(() => graft("compile")));
    record("`graft compile`, full tree", compiles);

    /* ---- Studio ---------------------------------------------------------- */

    const startStudio = async () => {
      const port = await freePort();
      const child = spawn(process.execPath, [cli, "studio", "--port", String(port)], {
        cwd: dir,
        // No DISPLAY, so the browser it tries to open stays closed.
        env: { ...env, DISPLAY: "", BROWSER: "true" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let log = "";
      child.stdout.on("data", (chunk) => (log += chunk));
      child.stderr.on("data", (chunk) => (log += chunk));
      const deadline = Date.now() + 30_000;
      while (!log.includes("graft studio")) {
        if (child.exitCode !== null || Date.now() > deadline) {
          throw new Error(`Studio did not start:\n${log}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const origin = `http://127.0.0.1:${port}`;
      return {
        origin,
        stop: () =>
          new Promise((resolve) => {
            if (child.exitCode !== null) return resolve();
            child.once("exit", resolve);
            child.kill("SIGTERM");
          }),
        async call(method, path, body) {
          const response = await fetch(`${origin}/api/studio/v1${path}`, {
            method,
            headers: body ? { "content-type": "application/json" } : {},
            ...(body ? { body: JSON.stringify(body) } : {}),
          });
          const text = await response.text();
          if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${text}`);
          return JSON.parse(text);
        },
      };
    };

    const firstPage = "/entries?collection=products";
    console.error("entries, cold (a new Studio each run)");
    const cold = [];
    for (let i = 0; i < runs; i += 1) {
      const s = await startStudio();
      cold.push(await time(() => s.call("GET", firstPage)));
      await s.stop();
    }
    record("`/entries`, first page, cold", cold);

    studio = await startStudio();
    const s = studio;
    await s.call("GET", firstPage);

    const warm = async (metric, path) => {
      const samples = [];
      for (let i = 0; i < runs; i += 1) samples.push(await time(() => s.call("GET", path)));
      record(metric, samples);
    };
    console.error("entries, warm");
    await warm("`/entries`, first page, warm", firstPage);
    await warm("Search (`q=linen`)", "/entries?collection=products&q=linen");
    await warm(
      "Filter and sort (on sale, by price)",
      "/entries?collection=products&where.status=active&sort=price&dir=desc",
    );

    // The same product every run, so no run pays to read a file another did not.
    const list = await s.call("GET", `${firstPage}&limit=1`);
    const slug = list.items[0].slug;
    const entry = () => s.call("GET", `/entry?collection=products&slug=${slug}`);
    const save = async (price) => {
      const current = await entry();
      return s.call("PUT", "/entry", {
        collection: "products",
        slug,
        data: { ...current.data, price },
        body: current.body,
        baseVersion: current.version,
      });
    };
    const basePrice = (await entry()).data.price;

    console.error(`local save (products/${slug})`);
    const saves = [];
    for (let i = 0; i < runs; i += 1) {
      const current = await entry();
      saves.push(
        await time(() =>
          s.call("PUT", "/entry", {
            collection: "products",
            slug,
            data: { ...current.data, price: basePrice + 100 * (i + 1) },
            body: current.body,
            baseVersion: current.version,
          }),
        ),
      );
    }
    record("Local save, one entry", saves);

    console.error("publish (a Git commit of one entry)");
    const publishes = [];
    for (let i = 0; i < runs; i += 1) {
      const saved = await save(basePrice + 7 * (i + 1));
      publishes.push(
        await time(() =>
          s.call("POST", "/drafts/publish", { paths: [saved.path], message: `Bench ${i}` }),
        ),
      );
    }
    record("Publish, one entry", publishes);
  } finally {
    await studio?.stop();
    if (!arg("db")) {
      try {
        sh("bash", [pgScript, "down", pgDir]);
      } catch {
        /* already stopped */
      }
    }
    if (!keep) rmSync(dir, { recursive: true, force: true });
    else console.error(`kept ${dir}`);
  }
}

/* ---- bundle sizes -------------------------------------------------------- */

const html = readFileSync(join(ui, "index.html"), "utf8");
const entry = html.match(/<script[^>]+src="\.\/([^"]+\.js)"/)?.[1];
/** The chunks a chunk imports statically: what loads with it. import() is not followed. */
const staticImports = (file) =>
  [
    ...readFileSync(join(ui, file), "utf8").matchAll(
      /(?:^|[;}\s])(?:import|export)\s*(?:[\w$*{}\s,]*?\bfrom\s*)?["']\.\/([^"']+\.js)["']/g,
    ),
  ].map((match) => join(dirname(file), match[1]));
/** `from` and every chunk it reaches through static imports, short of `stop`. */
const closure = (from, stop = new Set()) => {
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file) || stop.has(file)) return;
    seen.add(file);
    for (const next of staticImports(file)) visit(next);
  };
  for (const file of from) visit(file);
  return seen;
};
// The editors' own chunks: named after the editor modules, or the manual
// "editor" chunk older builds used.
const editorEntries = new Set(
  readdirSync(join(ui, "assets"))
    .filter((file) => /^(rich-)?editor-.*\.js$/.test(file))
    .map((file) => `assets/${file}`),
);
// What every page loads: the entry and everything it imports statically.
const initial = [...closure([entry])];
// What the editors add: their chunks and what those import that the app,
// without them, does not already load. The same rule before and after the
// editors became lazy, so the two numbers compare.
const app = closure([entry], editorEntries);
const editorChunks = [...closure([...editorEntries], app)];
const sizeOf = (files) => {
  let raw = 0;
  let gz = 0;
  for (const file of files) {
    const bytes = readFileSync(join(ui, file));
    raw += bytes.length;
    gz += gzipSync(bytes).length;
  }
  return { raw, gz };
};
// Decimal units, as the earlier numbers were reported.
const kb = ({ raw, gz }) => `${(raw / 1e6).toFixed(2)} MB (${(gz / 1e3).toFixed(0)} kB gzip)`;

/* ---- the table ------------------------------------------------------------ */

const format = (value, unit) =>
  unit === "ms" && value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${value.toFixed(0)} ms`;
const lines = [
  process.argv.includes("--sizes")
    ? "Studio bench: bundle sizes only"
    : `Studio bench: ${count} products, median of ${runs} runs, Node ${process.version}`,
  "",
  "| Metric | Median | Runs |",
  "| --- | --- | --- |",
  ...rows.map(
    ({ metric, samples, unit }) =>
      `| ${metric} | ${format(median(samples), unit)} | ${samples.map((v) => v.toFixed(0)).join(", ")} |`,
  ),
  `| Initial JS (what every page loads) | ${kb(sizeOf(initial))} | ${initial.length} files |`,
  `| Editor JS (Milkdown and CodeMirror) | ${kb(sizeOf(editorChunks))} | ${editorChunks.length} files, ${initial.some((file) => editorEntries.has(file)) ? "loaded with every page" : "loaded when an entry opens"} |`,
];
console.log(lines.join("\n"));
