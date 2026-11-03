/**
 * Build and run a real Nuxt app on @usegraft/sdk-nuxt, and check what the
 * module promises on that Nuxt. Each folder here (nuxt4, nuxt5) pins one major
 * in the lockfile and runs this from its own directory:
 *
 *   pnpm --filter sdk-nuxt-compat-nuxt4 smoke
 *
 * It needs the module and its workspace dependencies built first
 * (`pnpm turbo run build --filter=@usegraft/sdk-nuxt... --filter=@usegraft/cli...`).
 *
 * It type-checks the app, and the module's runtime against this Nuxt's types.
 *
 * What it checks, in a production build served by `node .output/server/index.mjs`:
 * - a page's useGraftContent read is in the server-rendered HTML, with its MDX
 *   body rendered by <GraftMdx>, and useGraftList and useGraftSearch beside it
 * - a missing slug is a 404
 * - a server route reads through the auto-imported useGraft()
 * - the content API answers at /api/content/v1
 * - functions and MCP answer 503 with a fix when the engine is the static index
 * - in Chromium: the page hydrates without a warning, and a client-side
 *   navigation reads the next document over HTTP
 */
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkDevLoop } from "../../../scripts/lib/dev-loop.mjs";

const appDir = process.cwd();
const compatDir = fileURLToPath(new URL(".", import.meta.url));
const workspace = join(compatDir, "../..");
const portFlag = process.argv.indexOf("--port");
const port = portFlag > 0 ? Number(process.argv[portFlag + 1]) : 3120;
const base = `http://127.0.0.1:${port}`;

const nuxtVersion = createRequire(join(appDir, "package.json"))("nuxt/package.json").version;
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

console.log(`sdk-nuxt compat smoke on nuxt@${nuxtVersion}`);

// 1. The module copy this app runs must be the current build. pnpm injects a
// copy at install time (so it resolves this app's Nuxt and Vue), and a later
// rebuild does not reach it. Refresh its dist and manifest. sdk-vue is not a
// dependency of this app, as it is not of a real one: it arrives through the
// module, which is what the module's re-exports are tested against.
for (const name of ["sdk-nuxt"]) {
  const source = join(workspace, name);
  const copy = realpathSync(join(appDir, "node_modules/@usegraft", name));
  if (!existsSync(join(source, "dist"))) {
    console.error(`packages/${name}/dist is missing. Build it first.`);
    process.exit(1);
  }
  if (copy === realpathSync(source)) continue;
  rmSync(join(copy, "dist"), { recursive: true, force: true });
  cpSync(join(source, "dist"), join(copy, "dist"), { recursive: true });
  const manifest = readFileSync(join(source, "package.json"), "utf8");
  if (readFileSync(join(copy, "package.json"), "utf8") !== manifest) {
    writeFileSync(join(copy, "package.json"), manifest);
  }
}

// 2. The app: shared source and a fresh index.
for (const entry of ["app", "server", "content", "graft.config.ts"]) {
  rmSync(join(appDir, entry), { recursive: true, force: true });
  cpSync(join(compatDir, "app-src", entry), join(appDir, entry), { recursive: true });
}
for (const built of [".nuxt", ".output", ".graft"]) {
  rmSync(join(appDir, built), { recursive: true, force: true });
}
run("pnpm exec graft compile");

// 3. Build, then typecheck against this Nuxt's own types: the app, and the
// module's runtime source, which the app's TypeScript reads (see the module's
// scripts/copy-runtime.mjs).
run("pnpm exec nuxi build");
run("pnpm exec nuxi typecheck");

// 4. Serve it and check behavior over HTTP.
const server = spawn("node .output/server/index.mjs", {
  cwd: appDir,
  shell: true,
  stdio: ["ignore", "inherit", "inherit"],
  env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", NODE_ENV: "production" },
  detached: process.platform !== "win32",
});

function stop() {
  if (process.platform === "win32") spawnSync(`taskkill /pid ${server.pid} /T /F`, { shell: true });
  else process.kill(-server.pid, "SIGTERM");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    await sleep(500);
    ready = await fetch(`${base}/api/title/home`).then(
      (r) => r.ok,
      () => false,
    );
  }
  check(ready, `the server answers on ${base}`);
  if (!ready) throw new Error("server never came up");

  const home = await fetch(`${base}/home`);
  const html = await home.text();
  check(
    home.status === 200 && html.includes("<h1>Home</h1>"),
    "useGraftContent is server-rendered",
  );
  check(html.includes("Where the smoke starts."), "the document's typed fields render");
  check(html.includes("<strong>Graft</strong>"), "<GraftMdx> renders the body on the server");

  const index = await (await fetch(`${base}/`)).text();
  check(
    index.includes('href="/home"') && index.includes('href="/about"'),
    "useGraftList is server-rendered",
  );
  check(index.includes("hits:about"), "useGraftSearch is server-rendered");

  check((await fetch(`${base}/nope`)).status === 404, "a missing slug is a 404");

  const title = await (await fetch(`${base}/api/title/about`)).json();
  check(title.title === "About", "a server route reads through useGraft()");

  const api = await fetch(`${base}/api/content/v1/documents?collection=pages&slug=home`);
  const apiBody = await api.json();
  check(
    api.status === 200 && JSON.stringify(apiBody).includes('"title":"Home"'),
    "the content API answers at /api/content/v1",
  );

  for (const [path, body] of [
    ["/api/fn/anything", "{}"],
    ["/api/mcp", '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'],
  ]) {
    const response = await fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body,
    });
    const error = await response.json().catch(() => ({}));
    check(
      response.status === 503 &&
        error.error === "CONFIG_INVALID" &&
        /postgres/i.test(error.fix ?? ""),
      `${path} answers 503 CONFIG_INVALID with a fix on the static index`,
    );
  }

  // 5. In a browser: hydration, then a client-side navigation.
  const { chromium } = createRequire(join(appDir, "package.json"))("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const logged = [];
    page.on("console", (message) => {
      if (["warning", "error"].includes(message.type())) logged.push(message.text());
    });
    // An exception thrown in the page, which never reaches the console.
    page.on("pageerror", (error) => logged.push(String(error)));
    const contentRequests = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/content/v1/")) contentRequests.push(request.url());
    });
    await page.goto(`${base}/home`, { waitUntil: "networkidle" });
    check(
      contentRequests.length === 0,
      "hydration reuses the server's read instead of fetching again",
    );
    await page.click("#to-about");
    await page.waitForSelector("h1:text('About')", { timeout: 10_000 });
    check(true, "a client-side navigation renders the next document");
    check(
      contentRequests.some((url) => url.includes("slug=about")),
      "the navigation read the document over HTTP",
    );
    check(
      (await page.innerHTML("main")).includes("<em>this</em>"),
      "<GraftMdx> renders the next body in the browser",
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

// The dev loop a generated site runs as `npm run dev`: `graft dev -- <dev
// server>`, where saving a content file changes the page with no restart.
const devPort = port + 1;
await checkDevLoop({
  appDir,
  devServer: ["nuxt", "dev", "--port", String(devPort)],
  url: `http://localhost:${devPort}/home`,
  file: "content/pages/home.mdx",
  edit: ["title: Home", "title: Home, edited"],
  before: "<h1>Home</h1>",
  after: "<h1>Home, edited</h1>",
  check,
});

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed on nuxt@${nuxtVersion}.`);
  process.exit(1);
}
console.log(`\nAll checks passed on nuxt@${nuxtVersion}.`);
