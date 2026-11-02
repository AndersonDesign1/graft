/**
 * Build and run a real SvelteKit app on @usegraft/sdk-sveltekit, and check
 * what the adapter promises on that SvelteKit. Each folder here (kit2, kit3)
 * pins one major in the lockfile and runs this from its own directory:
 *
 *   pnpm --filter sdk-sveltekit-compat-kit3 smoke
 *
 * It needs the adapter and its workspace dependencies built first
 * (`pnpm turbo run build --filter=@usegraft/sdk-sveltekit... --filter=@usegraft/content-api... --filter=@usegraft/cli...`).
 *
 * It type-checks the app, which is the SvelteKit guide's code, against this
 * SvelteKit's own types: `graftRoute` as a RequestHandler, and the reads in
 * typed `load` functions.
 *
 * What it checks, in a production build served by adapter-node:
 * - a server `load` reads a document with `getContent`, and a missing slug is a 404
 * - the guide's `Cache-Tag` header carries the document's tags
 * - `listContent` and `searchContent` read in a `load` beside it
 * - `graftRoute` hands a handler SvelteKit's Request with method, headers and body
 * - the content API, mounted with `graftRoute`, answers
 * - MdxContent renders the body prepareMdx prepared: Markdown, a GFM table,
 *   a component from the app, and links with script URLs dropped
 * - the browser bundle carries no server code
 * - in Chromium: the page hydrates without a warning, and a client-side
 *   navigation runs the next `load` on the server
 */
import { spawn, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = process.cwd();
const compatDir = fileURLToPath(new URL(".", import.meta.url));
const sdkDir = join(compatDir, "..");
const portFlag = process.argv.indexOf("--port");
const port = portFlag > 0 ? Number(process.argv[portFlag + 1]) : 3130;
const base = `http://127.0.0.1:${port}`;

const appRequire = createRequire(join(appDir, "package.json"));
const kitVersion = appRequire("@sveltejs/kit/package.json").version;
const major = Number.parseInt(kitVersion, 10);
const failures = [];

function check(ok, what) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
}

function run(command) {
  console.log(`\n$ ${command}`);
  // shell: true so pnpm's shims resolve on Windows. Commands are fixed strings.
  const result = spawnSync(command, { cwd: appDir, shell: true, stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`\n${command} exited with ${result.status}`);
    process.exit(1);
  }
}

console.log(`sdk-sveltekit compat smoke on @sveltejs/kit@${kitVersion}`);

// 1. The adapter copy this app runs must be the current build. pnpm injects a
// copy at install time, and a later rebuild does not reach it. Refresh its
// dist and manifest.
const copy = realpathSync(join(appDir, "node_modules/@usegraft/sdk-sveltekit"));
if (!existsSync(join(sdkDir, "dist"))) {
  console.error("packages/sdk-sveltekit/dist is missing. Build it first.");
  process.exit(1);
}
if (copy !== realpathSync(sdkDir)) {
  rmSync(join(copy, "dist"), { recursive: true, force: true });
  cpSync(join(sdkDir, "dist"), join(copy, "dist"), { recursive: true });
  const manifest = readFileSync(join(sdkDir, "package.json"), "utf8");
  if (readFileSync(join(copy, "package.json"), "utf8") !== manifest) {
    writeFileSync(join(copy, "package.json"), manifest);
  }
}

// 2. The app: shared source and a fresh index.
// Each app folder keeps its own Vite config and tsconfig, which the majors
// spell differently: SvelteKit 3 takes its options in the Vite plugin and its
// tsconfig extends `$app/tsconfig`.
for (const entry of ["src", "content", "graft.config.ts"]) {
  rmSync(join(appDir, entry), { recursive: true, force: true });
  cpSync(join(compatDir, "app-src", entry), join(appDir, entry), { recursive: true });
}
// SvelteKit 3 removed `$lib`: the shared source imports `#lib/server/graft.ts`,
// a package.json subpath import. On SvelteKit 2 the app imports
// `$lib/server/graft`, as SvelteKit 2 projects do and the guide shows.
if (major === 2) {
  for (const file of readdirSync(join(appDir, "src"), { recursive: true })) {
    const path = join(appDir, "src", String(file));
    if (!/\.(ts|svelte)$/.test(path)) continue;
    const source = readFileSync(path, "utf8");
    const rewritten = source.replaceAll('"#lib/server/graft.ts"', '"$lib/server/graft"');
    if (rewritten !== source) writeFileSync(path, rewritten);
  }
}
for (const built of [".svelte-kit", "build", ".graft"]) {
  rmSync(join(appDir, built), { recursive: true, force: true });
}
run("pnpm exec graft compile");

// 3. Type-check against this SvelteKit's generated types, then build.
run("pnpm exec svelte-kit sync");
run("pnpm exec svelte-check --tsconfig ./tsconfig.json --fail-on-warnings");
run("pnpm exec vite build");

// The browser bundle must not carry the database client or the index reader.
const clientDir = join(appDir, ".svelte-kit/output/client");
const clientCode = readdirSync(clientDir, { recursive: true })
  .filter((file) => String(file).endsWith(".js"))
  .map((file) => readFileSync(join(clientDir, String(file)), "utf8"))
  .join("\n");
check(
  clientCode.length > 0 && !/node:sqlite|openStaticIndex|content_index|micromark/.test(clientCode),
  "the browser bundle carries no server code, the MDX parser included",
);

// 4. Serve it and check behavior over HTTP.
const server = spawn("node build", {
  cwd: appDir,
  shell: true,
  stdio: ["ignore", "inherit", "inherit"],
  env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", NODE_ENV: "production" },
  detached: process.platform !== "win32",
});

function stop() {
  if (process.platform === "win32") {
    spawnSync(`taskkill /pid ${server.pid} /T /F`, { shell: true });
    return;
  }
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch (error) {
    // Already gone: the server died on its own, and the checks above say why.
    if (error?.code !== "ESRCH") throw error;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * HTML without the comment markers Svelte puts inside elements for hydration,
 * so a check can match `<strong>Graft</strong>`. Repeated until nothing
 * changes, so a removal can't leave a new `<!--` behind. For assertions on our
 * own build only: this is not a sanitiser.
 */
function withoutComments(markup) {
  let previous;
  let current = markup;
  do {
    previous = current;
    current = previous.replace(/<!--[\s\S]*?-->/g, "");
  } while (current !== previous);
  return current;
}

try {
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    await sleep(500);
    ready = await fetch(`${base}/home`).then(
      (r) => r.ok,
      () => false,
    );
  }
  check(ready, `the server answers on ${base}`);
  if (!ready) throw new Error("server never came up");

  const home = await fetch(`${base}/home`);
  const html = await home.text();
  check(home.status === 200 && html.includes("<h1>Home</h1>"), "a server load reads its document");
  check(html.includes("Where the smoke starts."), "the document's typed fields render");
  check(
    (home.headers.get("cache-tag") ?? "").includes("graft:main:pages:home"),
    "the guide's Cache-Tag header carries the document's tags",
  );

  // The MDX body, prepared on the server and rendered by MdxContent.
  // Only the rendered body: the page data SvelteKit embeds after it holds the
  // raw source, script URL included, as text.
  const body = withoutComments(
    html.slice(html.indexOf('<div class="body">'), html.indexOf('<a id="to-about"')),
  );
  check(body.includes("<strong>Graft</strong>"), "MdxContent renders the body on the server");
  check(
    body.includes('href="https://graft.page"') && !body.includes("javascript:"),
    "a safe link keeps its href, and a script URL is dropped",
  );
  check(
    /<aside class="callout callout-tip">[\s\S]*<em>Markdown<\/em>[\s\S]*<\/aside>/.test(body),
    "a component from the app renders, with the Markdown inside it",
  );
  check(/<table>[\s\S]*<td>static<\/td>/.test(body), "a GFM table renders");

  const unsafe = withoutComments(await (await fetch(`${base}/unsafe`)).text());
  const unsafeMain = unsafe.slice(unsafe.indexOf("<main>"), unsafe.indexOf("</main>"));
  check(
    unsafeMain.includes('<p class="kept">Safe text.</p>') &&
      // Case-insensitive, so <SCRIPT> or onClick would fail the check too.
      !["<script", "onclick", "<b>raw"].some((piece) => unsafeMain.toLowerCase().includes(piece)),
    "a hand-built tree renders without its script, handler or raw HTML",
  );

  check((await fetch(`${base}/nope`)).status === 404, "a missing slug is a 404");

  const index = await (await fetch(`${base}/`)).text();
  check(
    index.includes('href="/home"') && index.includes('href="/about"'),
    "listContent reads in a load",
  );
  check(index.includes("hits:about"), "searchContent reads in a load");

  // JSON, as Graft's functions and MCP callers send. SvelteKit refuses a
  // cross-site POST with a form content type (text/plain included) as CSRF.
  const echo = await fetch(`${base}/api/echo`, {
    method: "POST",
    headers: { "x-graft": "yes", "content-type": "application/json" },
    body: '{"hello":true}',
  });
  const echoed = await echo.json().catch(() => ({}));
  check(
    echoed.method === "POST" &&
      echoed.url === "/api/echo" &&
      echoed.header === "yes" &&
      echoed.body === '{"hello":true}',
    "graftRoute hands the handler the request's method, headers and body",
  );

  const api = await fetch(`${base}/api/content/v1/documents?collection=pages&slug=home`);
  const apiBody = await api.text();
  check(
    api.status === 200 && apiBody.includes('"title":"Home"'),
    "the content API answers through graftRoute",
  );

  // 5. In a browser: hydration, then a client-side navigation.
  const { chromium } = appRequire("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const logged = [];
    page.on("console", (message) => {
      if (["warning", "error"].includes(message.type())) logged.push(message.text());
    });
    // An exception thrown in the page, which never reaches the console.
    page.on("pageerror", (error) => logged.push(String(error)));
    const dataRequests = [];
    page.on("request", (request) => {
      if (request.url().includes("__data.json")) dataRequests.push(request.url());
    });
    await page.goto(`${base}/home`, { waitUntil: "networkidle" });
    check(
      dataRequests.length === 0,
      "hydration reuses the server's read instead of fetching again",
    );
    await page.click("#to-about");
    await page.waitForSelector("h1:text('About')", { timeout: 10_000 });
    check(true, "a client-side navigation renders the next document");
    check(
      dataRequests.some((url) => url.includes("/about/__data.json")),
      "the navigation ran the next load on the server",
    );
    check(
      withoutComments(await page.innerHTML("main")).includes("<em>this</em>"),
      "MdxContent renders the next body in the browser",
    );
    check(
      withoutComments(await page.innerHTML("main")).includes(
        '<aside class="callout callout-empty">No content.</aside>',
      ),
      "a component with no content gets no children, so its own fallback shows",
    );
    check(
      logged.length === 0,
      `no warnings or errors in the console${logged.length ? `: ${logged.join(" | ")}` : ""}`,
    );
  } finally {
    await browser.close();
  }
} catch (error) {
  failures.push(String(error));
  console.error(error);
} finally {
  stop();
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed on @sveltejs/kit@${kitVersion}.`);
  process.exit(1);
}
console.log(`\nAll checks passed on @sveltejs/kit@${kitVersion}.`);
