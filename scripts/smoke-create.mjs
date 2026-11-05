/**
 * Make a site with `graft create --framework <name>` from this checkout, and
 * prove it works the way someone who just ran `npm create graft` would find
 * it: it installs, type-checks, builds, serves its pages with each MDX body
 * rendered, keeps server code out of the browser, and `npm run dev` shows a
 * content edit on the next page load.
 *
 *   node scripts/smoke-create.mjs --framework astro [--port 3140]
 *
 * Build the CLI and the framework's adapter first, with everything they
 * depend on: the site installs this checkout's packages, packed as npm would
 * see them, in place of the registry's. The framework
 * itself comes from npm at the range the template asks for, so this checks
 * the version a new site gets today.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkDevLoop } from "./lib/dev-loop.mjs";
import { packLocal } from "./lib/pack-local.mjs";

const repo = resolve(fileURLToPath(new URL("..", import.meta.url)));
const flag = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? process.argv[at + 1] : fallback;
};
const framework = flag("framework");
const port = Number(flag("port", "3140"));
const devPort = port + 1;
const base = `http://127.0.0.1:${port}`;

/** Where each framework writes its browser bundle. */
const CLIENT_DIR = {
  astro: "dist/client",
  "react-router": "build/client",
  "tanstack-start": "dist/client",
  next: ".next/static",
  nuxt: ".output/public",
  sveltekit: "build/client",
};
if (!framework || !(framework in CLIENT_DIR)) {
  console.error(
    `Usage: node scripts/smoke-create.mjs --framework <${Object.keys(CLIENT_DIR).join("|")}>`,
  );
  process.exit(2);
}

/** The Playwright the compat smokes pin, so CI installs one browser for all of them. */
const PLAYWRIGHT = "1.63.0";

const failures = [];
function check(ok, what) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
}

const work = mkdtempSync(join(tmpdir(), `graft-create-${framework}-`));
const site = join(work, "site");

function run(command, args, cwd = site) {
  console.log(`\n$ ${[command, ...args].join(" ")}`);
  // No shell: every argument is a fixed string or a path this script made.
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  // Thrown, not process.exit: a run after the server starts must still reach
  // the `finally` that stops it.
  if (result.status !== 0) throw new Error(`${command} ${args[0]} exited with ${result.status}`);
}

// 1. The site, as `npm create graft` writes it. Files and no database, so
// nothing here reaches the network but npm.
console.log(`graft create --framework ${framework}, from ${repo}`);
run(
  process.execPath,
  [
    join(repo, "packages/cli/dist/index.js"),
    "create",
    site,
    "--template",
    "blog",
    "--edit",
    "code",
    "--database",
    "none",
    "--framework",
    framework,
    "--no-install",
    "--yes",
  ],
  work,
);

// 2. This checkout's packages in place of the registry's.
const manifestPath = join(site, "package.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const graftPackages = ["dependencies", "devDependencies"].flatMap((field) =>
  Object.keys(manifest[field] ?? {}).filter((name) => name.startsWith("@usegraft/")),
);
const overrides = packLocal(join(work, "packages"), graftPackages);
for (const field of ["dependencies", "devDependencies"]) {
  for (const name of Object.keys(manifest[field] ?? {})) {
    if (overrides[name]) manifest[field][name] = overrides[name];
  }
}
manifest.overrides = overrides;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

// A page whose body exercises the renderer: Markdown, a GFM table, a
// component the site has no entry for, and a link a visitor must not be able
// to run.
writeFileSync(
  join(site, "content/pages/smoke.mdx"),
  `---
title: Smoke
tagline: Every kind of body the renderer handles.
---

Built with **Graft**. [Safe](https://graft.page) and [unsafe](javascript:alert(1)).

| engine | file |
| ------ | ---- |
| static | index.db |

<Callout type="tip">

Inside a *component*.

</Callout>
`,
);

run("npm", ["install", "--no-audit", "--no-fund"]);
run("npx", ["graft", "compile"]);

// 3. Build, then type-check the way the framework does. After the build,
// because TanStack Start writes its route tree on the first build or dev run.
run("npm", ["run", "build"]);
if (manifest.scripts.typecheck) {
  run("npm", ["run", "typecheck"]);
} else if (framework === "astro") {
  run("npm", ["install", "--no-audit", "--no-fund", "--no-save", "@astrojs/check", "typescript"]);
  run("npx", ["astro", "check"]);
}

const clientDir = join(site, CLIENT_DIR[framework]);
const clientCode = existsSync(clientDir)
  ? readdirSync(clientDir, { recursive: true })
      .filter((file) => String(file).endsWith(".js"))
      .map((file) => readFileSync(join(clientDir, String(file)), "utf8"))
      .join("\n")
  : "";
// An empty or missing bundle would pass the check below without testing it.
// Astro's pages ship no JavaScript, so its client folder must exist and hold none.
if (framework === "astro") {
  check(
    existsSync(clientDir) && clientCode === "",
    `the build wrote ${CLIENT_DIR[framework]} with no JavaScript in it`,
  );
} else {
  check(clientCode.length > 0, `the build wrote a browser bundle to ${CLIENT_DIR[framework]}`);
}
check(
  !/node:sqlite|openStaticIndex|content_index|micromark/.test(clientCode),
  "the browser bundle carries no server code, the Markdown parser included",
);

// 4. Serve the build the way `npm start` does, and read it over HTTP.
/** A request that gives up after 10 seconds, so a stalled server cannot hang the smoke. */
const get = (path) => fetch(`${base}${path}`, { signal: AbortSignal.timeout(10_000) });

// Something already answering on the port would be checked in place of this site.
if (
  await get("/").then(
    () => true,
    () => false,
  )
) {
  throw new Error(`Something already answers on ${base}. Pass a free --port.`);
}
const server = spawn("npm", ["start"], {
  cwd: site,
  stdio: ["ignore", "inherit", "inherit"],
  env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", NODE_ENV: "production" },
  detached: true,
});
let serverExited = false;
server.once("exit", () => {
  serverExited = true;
});

function stop() {
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

/** The page without the comment markers frameworks put inside elements. */
async function page(path) {
  const response = await get(path);
  let html = await response.text();
  let previous;
  do {
    previous = html;
    html = previous.replace(/<!--[\s\S]*?-->/g, "");
  } while (html !== previous);
  return { status: response.status, html };
}

/** Only the rendered page, without the data a framework embeds after it for hydration. */
const mainOf = (html) => html.slice(html.indexOf("<main"), html.indexOf("</main>"));

try {
  let ready = false;
  for (let i = 0; i < 120 && !ready && !serverExited; i++) {
    await new Promise((done) => setTimeout(done, 500));
    ready = await get("/").then(
      (r) => r.ok,
      () => false,
    );
  }
  // Still running: an answer from a server that has exited came from something else.
  check(ready && !serverExited, `npm start serves the site on ${base}`);
  if (!ready) throw new Error("the server never came up");

  const home = await page("/");
  check(
    home.status === 200 && home.html.includes("<h1>Welcome</h1>"),
    "the home page reads pages/home",
  );
  check(
    home.html.includes("The latest posts are listed below it."),
    "the home page renders its MDX body",
  );
  check(home.html.includes("/posts/hello-world"), "the home page lists the featured posts");
  check(
    home.html.includes('href="/posts"') && home.html.includes(">Posts<"),
    "the navigation links each listed collection",
  );

  const posts = await page("/posts");
  check(
    posts.status === 200 &&
      posts.html.includes("<h1>Posts</h1>") &&
      posts.html.includes("/posts/how-we-work"),
    "a collection page lists its entries",
  );

  const post = await page("/posts/hello-world");
  check(
    post.status === 200 && /<h1>[^<]+<\/h1>/.test(post.html),
    "an entry page renders its document",
  );

  const smoke = mainOf((await page("/pages/smoke")).html);
  check(smoke.includes("<strong>Graft</strong>"), "MdxContent renders Markdown on the server");
  check(
    smoke.includes('href="https://graft.page"') && !smoke.includes("javascript:"),
    "a safe link keeps its href, and a script URL is dropped",
  );
  check(/<table>[\s\S]*<td>static<\/td>/.test(smoke), "a GFM table renders");
  check(
    smoke.includes("<em>component</em>") && !smoke.toLowerCase().includes("<callout"),
    "a component the site has no entry for renders its content without the wrapper",
  );

  check((await page("/posts/no-such-post")).status === 404, "a missing entry is a 404");
  check((await page("/no-such-collection")).status === 404, "a missing collection is a 404");

  // In Chromium: the page hydrates cleanly, and following a link renders the
  // next document. React Router and TanStack Start navigate in the browser,
  // reading through the server; Astro loads the next page.
  run("npm", ["install", "--no-audit", "--no-fund", "--no-save", `playwright@${PLAYWRIGHT}`]);
  const { chromium } = createRequire(manifestPath)("playwright");
  const browser = await chromium.launch();
  try {
    const tab = await browser.newPage();
    const logged = [];
    tab.on("console", (message) => {
      if (["warning", "error"].includes(message.type())) logged.push(message.text());
    });
    tab.on("pageerror", (error) => logged.push(String(error)));
    await tab.goto(`${base}/`, { waitUntil: "networkidle" });
    await tab.evaluate(() => {
      window.__sameDocument = true;
    });
    await tab.click('main a[href="/posts/hello-world"]');
    await tab.waitForSelector("h1:text('Hello, world')", { timeout: 10_000 });
    check(
      (await tab.innerHTML("main")).includes("This is your first post."),
      "following a link renders the next document and its body",
    );
    const sameDocument = await tab.evaluate(() => window.__sameDocument === true);
    check(
      sameDocument === (framework !== "astro"),
      framework === "astro"
        ? "Astro loads the next page from the server"
        : "the navigation happens in the browser, without a full page load",
    );
    check(
      logged.length === 0,
      `no warnings or errors in the console${logged.length ? `: ${logged.join(" | ")}` : ""}`,
    );
  } finally {
    await browser.close();
  }
} catch (error) {
  check(false, String(error));
} finally {
  stop();
}

// 5. `npm run dev`: a content edit shows on the next page load.
const dev = manifest.scripts.dev.replace(/^graft dev -- /, "").split(" ");
const portAt = dev.indexOf("--port");
if (portAt >= 0) dev.splice(portAt, 2);
await checkDevLoop({
  appDir: site,
  devServer: [...dev, "--port", String(devPort)],
  url: `http://localhost:${devPort}/posts/hello-world`,
  file: "content/posts/hello-world.mdx",
  edit: ["title: Hello, world", "title: Hello, edited"],
  // Without the opening tag: Astro's dev server adds source attributes to it.
  before: ">Hello, world</h1>",
  after: ">Hello, edited</h1>",
  check,
});

if (failures.length > 0) {
  console.error(
    `\n${failures.length} check(s) failed for --framework ${framework}. The site is in ${site}.`,
  );
  process.exit(1);
}
rmSync(work, { recursive: true, force: true });
console.log(`\nAll checks passed for --framework ${framework}.`);
