/**
 * Build and run a real Next.js app on @usegraft/sdk-next, and check what the
 * adapter promises on that Next. Each folder here (next14, next15, next16)
 * pins one major in the lockfile and runs this from its own directory:
 *
 *   pnpm --filter sdk-next-compat-next14 smoke
 *
 * It needs the adapter and its workspace dependencies built first
 * (`pnpm turbo run build --filter=@usegraft/sdk-next... --filter=@usegraft/cli...`).
 *
 * What it checks, in a production build served by `next start`:
 * - the Next.js guide's code type-checks against this Next and React
 * - `withGraft` sets the externals key this Next reads
 * - a page reads a document, renders its MDX, and reads it once per request
 * - a tagged read stays cached until the guide's revalidate route refreshes it,
 *   and that route refuses bad input
 * - `updateContent` inside a real Server Action refreshes on Next 16, and on
 *   14 and 15 returns FRAMEWORK_VERSION_UNSUPPORTED
 */
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = process.cwd();
const compatDir = fileURLToPath(new URL(".", import.meta.url));
const sdkDir = join(compatDir, "..");
const portFlag = process.argv.indexOf("--port");
const port = portFlag > 0 ? Number(process.argv[portFlag + 1]) : 3100;
const base = `http://127.0.0.1:${port}`;
const secret = "compat-smoke-secret";

const nextVersion = createRequire(join(appDir, "package.json"))("next/package.json").version;
const major = Number.parseInt(nextVersion, 10);
const failures = [];

function check(ok, what) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
}

function run(command, { capture = false } = {}) {
  console.log(`\n$ ${command}`);
  // shell: true so pnpm's shims resolve on Windows. Commands are fixed strings.
  const result = spawnSync(command, {
    cwd: appDir,
    shell: true,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
    env: { ...process.env, GRAFT_WEBHOOK_SECRET: secret },
  });
  if (capture) process.stdout.write(`${result.stdout ?? ""}${result.stderr ?? ""}`);
  if (result.status !== 0) {
    console.error(`\n${command} exited with ${result.status}`);
    process.exit(1);
  }
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

console.log(`sdk-next compat smoke on next@${nextVersion}`);

// 1. The adapter copy this app runs must be the current build, resolving this
// app's Next. pnpm injects a copy at install time, so a later rebuild of the
// adapter does not reach it. Refresh its dist and manifest from the workspace.
const adapter = realpathSync(join(appDir, "node_modules/@usegraft/sdk-next"));
const builtDist = join(sdkDir, "dist");
if (!existsSync(join(builtDist, "index.js"))) {
  console.error("packages/sdk-next/dist is missing. Build the adapter first.");
  process.exit(1);
}
if (adapter !== realpathSync(sdkDir)) {
  rmSync(join(adapter, "dist"), { recursive: true, force: true });
  cpSync(builtDist, join(adapter, "dist"), { recursive: true });
  // Often a hard link to the source already, and then identical.
  const manifest = readFileSync(join(sdkDir, "package.json"), "utf8");
  if (readFileSync(join(adapter, "package.json"), "utf8") !== manifest) {
    writeFileSync(join(adapter, "package.json"), manifest);
  }
}
const adapterNext = createRequire(join(adapter, "package.json"))("next/package.json").version;
check(
  adapterNext === nextVersion,
  `the adapter resolves next@${adapterNext} (this app: ${nextVersion})`,
);

// 2. The app: shared source, the guide's own revalidate route, a fresh index.
for (const entry of ["app", "lib", "content", "graft.config.ts"]) {
  rmSync(join(appDir, entry), { recursive: true, force: true });
  cpSync(join(compatDir, "app-src", entry), join(appDir, entry), { recursive: true });
}
cpSync(join(sdkDir, "guide/app/api/revalidate/route.ts"), join(appDir, "guide-route.ts"));
rmSync(join(appDir, ".next"), { recursive: true, force: true });
run("pnpm exec graft compile");

// 3. The guide's code, against this Next and React. With the workspace's
// TypeScript: the guide config extends the repo base, which the Next 14 app's
// TypeScript 5 cannot read. Its own TypeScript still runs `next build` below.
run(`pnpm -w exec tsc --noEmit -p ${JSON.stringify(join(appDir, "tsconfig.guide.json"))}`);

// 4. Build. Next prints a config warning for a key this version does not know.
const buildLog = run("pnpm exec next build", { capture: true });
check(
  !/Invalid next\.config|Unrecognized key/i.test(buildLog),
  "next build reports no config warnings",
);
const serverFiles = JSON.parse(
  readFileSync(join(appDir, ".next/required-server-files.json"), "utf8"),
);
const externals =
  major < 15
    ? serverFiles.config.experimental?.serverComponentsExternalPackages
    : serverFiles.config.serverExternalPackages;
check(
  Array.isArray(externals) && externals.includes("@usegraft/registry"),
  `withGraft set ${major < 15 ? "experimental.serverComponentsExternalPackages" : "serverExternalPackages"}`,
);

// 5. Serve it and check behavior over HTTP.
const server = spawn(`pnpm exec next start -p ${port} -H 127.0.0.1`, {
  cwd: appDir,
  shell: true,
  stdio: ["ignore", "inherit", "inherit"],
  env: { ...process.env, GRAFT_WEBHOOK_SECRET: secret },
  detached: process.platform !== "win32",
});

function stop() {
  if (process.platform === "win32") spawnSync(`taskkill /pid ${server.pid} /T /F`, { shell: true });
  else process.kill(-server.pid, "SIGTERM");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function stamp() {
  const html = await (await fetch(`${base}/stamp`)).text();
  return /stamp:([0-9a-f-]{36})/.exec(html)?.[1];
}

async function revalidate(body, auth = `Bearer ${secret}`) {
  return fetch(`${base}/api/revalidate`, {
    method: "POST",
    headers: { authorization: auth, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const HOME_CHANGED = { added: [], changed: ["pages/home"], removed: [], unchanged: 0 };

try {
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    await sleep(500);
    ready = await fetch(`${base}/home`).then(
      (r) => r.ok,
      () => false,
    );
  }
  check(ready, `next start answers on ${base}`);
  if (!ready) throw new Error("server never came up");

  const home = await fetch(`${base}/home`);
  const html = await home.text();
  check(home.status === 200 && html.includes("<h1>Home</h1>"), "a page reads its document");
  check(html.includes("<strong>Graft</strong>"), "MdxBody renders the body");
  check(
    html.includes("deduped:<!-- -->true") || html.includes("deduped:true"),
    "two reads in one render return the same object",
  );
  check((await fetch(`${base}/nope`)).status === 404, "a missing slug is a 404");

  const first = await stamp();
  check(
    first !== undefined && first === (await stamp()),
    "a tagged read stays cached between requests",
  );

  check(
    (await revalidate(HOME_CHANGED, "Bearer wrong")).status === 401,
    "the revalidate route refuses a bad secret",
  );
  check(
    (await revalidate({ changes: { ...HOME_CHANGED, changed: [1] } })).status === 400,
    "the revalidate route refuses non-string keys",
  );
  check(
    (await revalidate({ branch: [], changes: HOME_CHANGED })).status === 400,
    "the revalidate route refuses a non-string branch",
  );
  const refreshed = await revalidate({ branch: "main", changes: HOME_CHANGED });
  const tags = (await refreshed.json()).revalidated ?? [];
  check(
    refreshed.status === 200 && tags.length === 2,
    `revalidateContent refreshed ${tags.length} tags`,
  );

  // revalidateTag marks the entry stale. Depending on the version, the next
  // request may still be served stale while it refreshes in the background.
  let afterRevalidate = await stamp();
  for (let i = 0; i < 10 && afterRevalidate === first; i++) {
    await sleep(300);
    afterRevalidate = await stamp();
  }
  check(afterRevalidate !== first, "the tagged read refreshed after the revalidate route");

  // A real Server Action, called over HTTP the way the button calls it.
  const manifest = JSON.parse(
    readFileSync(join(appDir, ".next/server/server-reference-manifest.json"), "utf8"),
  );
  const actionIds = Object.keys(manifest.node ?? {});
  check(actionIds.length === 1, `one Server Action registered (found ${actionIds.length})`);
  const beforeAction = await stamp();
  const actionResponse = await fetch(`${base}/action`, {
    method: "POST",
    headers: {
      "Next-Action": actionIds[0],
      "Content-Type": "text/plain;charset=UTF-8",
      Accept: "text/x-component",
      Origin: base,
    },
    body: "[]",
  });
  const actionBody = await actionResponse.text();
  check(actionResponse.status === 200, `the Server Action answered ${actionResponse.status}`);
  if (major >= 16) {
    check(/"ok":true/.test(actionBody), "updateContent ran inside the Server Action");
    check(/graft:main:pages:home/.test(actionBody), "updateContent returned the home tags");
    // updateTag expires the entry at once: the very next read is fresh.
    check(
      (await stamp()) !== beforeAction,
      "the next read after updateContent is fresh, not stale",
    );
  } else {
    check(
      /"ok":false/.test(actionBody) && actionBody.includes("FRAMEWORK_VERSION_UNSUPPORTED"),
      "updateContent refuses with FRAMEWORK_VERSION_UNSUPPORTED before Next 16",
    );
  }
} catch (error) {
  check(false, `smoke run threw: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  stop();
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed on next@${nextVersion}.`);
  process.exit(1);
}
console.log(`\nAll checks passed on next@${nextVersion}.`);
