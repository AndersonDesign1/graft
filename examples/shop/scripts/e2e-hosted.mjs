/**
 * End to end: a hosted Studio saves and publishes through GitHub.
 *
 *   DATABASE_URL=postgres://… node scripts/e2e-hosted.mjs
 *
 * What it proves, in order:
 *   1. `graft serve --studio` boots with the content directory read-only, the
 *      way a serverless or immutable deployment ships it.
 *   2. An editor signs in with a link from `graft studio invite`.
 *   3. A save lands as a commit on the editor's draft branch, authored by the
 *      editor, and the read-only files are untouched.
 *   4. Publishing lands one commit on the production branch with the edit.
 *
 * GitHub itself is played by the in-memory GitHub from
 * `@usegraft/compiler/testing`, served over real HTTP, so this runs without
 * credentials. Against real GitHub the same steps are the manual check in
 * the Studio hosting guide: point GRAFT_GITHUB_* at a test repository.
 */
import { spawn, execFileSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGitHubFake } from "@usegraft/compiler/testing";

const here = new URL("..", import.meta.url).pathname;
const cli = join(here, "../../packages/cli/dist/index.js");
if (!process.env.DATABASE_URL) {
  console.error("Set DATABASE_URL to a Postgres database this script may compile into.");
  process.exit(1);
}

function step(message) {
  console.log(`\n▸ ${message}`);
}
function check(condition, message) {
  if (!condition) {
    console.error(`  ✗ ${message}`);
    process.exit(1);
  }
  console.log(`  ✓ ${message}`);
}

/* ---- the deployed project, read-only ----------------------------------- */

step("Deploy a copy of the shop with a read-only content directory");
const site = mkdtempSync(join(tmpdir(), "graft-hosted-"));
for (const entry of ["content", "graft", "graft.config.ts", "package.json"]) {
  cpSync(join(here, entry), join(site, entry), { recursive: true });
}
symlinkSync(join(here, "node_modules"), join(site, "node_modules"));
const readOnly = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) readOnly(full);
    chmodSync(full, statSync(full).isDirectory() ? 0o555 : 0o444);
  }
  chmodSync(dir, 0o555);
};
readOnly(join(site, "content"));
const productPath = "products/" + readdirSync(join(site, "content", "products")).sort()[0];
const before = readFileSync(join(site, "content", productPath), "utf8");
check(true, `content is read-only; editing ${productPath}`);

/* ---- GitHub ------------------------------------------------------------ */

step("Start a GitHub-compatible server seeded with the same content");
const files = {};
const walk = (dir, prefix) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, `${prefix}${name}/`);
    else files[`${prefix}${name}`] = readFileSync(full, "utf8");
  }
};
walk(join(here, "content"), "content/");
const github = createGitHubFake({ repo: "acme/shop", files, token: "ghs_test" });
const { url: apiUrl, close: closeGitHub } = await github.listen();
const deployed = github.head();
check(Boolean(deployed), `GitHub at ${apiUrl}, main at ${deployed.slice(0, 7)}`);

/* ---- the hosted Studio ------------------------------------------------- */

step("Boot graft serve --studio, writing through GitHub");
const port = 3900 + Math.floor(Math.random() * 90);
const origin = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  PORT: String(port),
  GRAFT_STUDIO: "1",
  GRAFT_STUDIO_SECRET: "e2e-secret-that-is-long-enough-to-sign-with",
  GRAFT_STUDIO_URL: origin,
  GRAFT_GITHUB_REPO: "acme/shop",
  GRAFT_GITHUB_TOKEN: "ghs_test",
  GRAFT_GITHUB_API_URL: apiUrl,
  GRAFT_GITHUB_CONTENT_PATH: "content",
  GRAFT_STUDIO_PUBLISH: "commit",
  GRAFT_DEPLOYED_SHA: deployed,
};
execFileSync("node", [cli, "db", "migrate"], { cwd: site, env, stdio: "ignore" });
execFileSync("node", [cli, "compile"], { cwd: site, env, stdio: "ignore" });
const server = spawn("node", [cli, "serve", "--studio"], { cwd: site, env, stdio: "pipe" });
let log = "";
server.stdout.on("data", (chunk) => (log += chunk));
server.stderr.on("data", (chunk) => (log += chunk));
for (let i = 0; i < 50 && !log.includes("studio"); i += 1)
  await new Promise((r) => setTimeout(r, 200));
check(log.includes("/studio"), "serving /studio");

const cleanup = async () => {
  server.kill();
  await closeGitHub();
};

try {
  /* ---- sign in ---------------------------------------------------------- */

  step("Sign in with an invite link");
  const signedOut = await fetch(`${origin}/api/studio/v1/workspace`);
  check(signedOut.status === 401, "a signed-out request is refused");
  const invite = execFileSync(
    "node",
    [
      cli,
      "studio",
      "invite",
      "ana@shop.test",
      "--name",
      "Ana Lima",
      "--role",
      "editor",
      "--url",
      origin,
    ],
    { cwd: site, env, encoding: "utf8" },
  );
  const link = invite.match(/https?:\/\/\S+/)?.[0];
  const signIn = await fetch(link, { redirect: "manual" });
  const cookie = signIn.headers
    .getSetCookie()
    .find((c) => c.startsWith("graft_studio="))
    ?.split(";")[0];
  check(signIn.status === 302 && cookie, "the link sets a session");

  const api = (path, init = {}) =>
    fetch(`${origin}/api/studio/v1${path}`, {
      ...init,
      headers: { cookie, "content-type": "application/json", origin, ...init.headers },
    }).then(async (res) => ({ status: res.status, body: await res.json() }));

  const workspace = await api("/workspace");
  check(
    workspace.body.storage === "github" && workspace.body.publish === "publish",
    `workspace: saves go to ${workspace.body.storage}, Publish commits to ${workspace.body.repository}`,
  );

  /* ---- save ------------------------------------------------------------- */

  step("Edit a product's price");
  const slug = productPath.split("/")[1].replace(/\.mdx$/, "");
  const entry = await api(`/entry?collection=products&slug=${slug}`);
  const newPrice = entry.body.data.price + 1000;
  const saved = await api("/entry", {
    method: "PUT",
    body: JSON.stringify({
      collection: "products",
      slug,
      data: { ...entry.body.data, price: newPrice },
      body: entry.body.body,
      baseVersion: entry.body.version,
    }),
  });
  check(saved.status === 200 && saved.body.status === "changed", "saved as an unpublished change");
  const draftBranch = github
    .branches()
    .find((b) => b.startsWith("graft-studio/drafts/ana-shop-test-"));
  const draft = github.files(draftBranch)[`content/${productPath}`];
  check(draft?.includes(`price: ${newPrice}`), "the draft branch has the new price");
  check(github.log(draftBranch)[0].author.name === "Ana Lima", "authored by the editor");
  check(
    readFileSync(join(site, "content", productPath), "utf8") === before,
    "the deployed file is untouched",
  );
  check(
    !github.files()[`content/${productPath}`].includes(`price: ${newPrice}`),
    "production is untouched",
  );

  const stale = await api("/entry", {
    method: "PUT",
    body: JSON.stringify({
      collection: "products",
      slug,
      data: { ...entry.body.data, price: 1 },
      body: entry.body.body,
      baseVersion: entry.body.version,
    }),
  });
  check(
    stale.status === 409 && stale.body.error === "CONTENT_CONFLICT",
    "a save from a stale read is refused",
  );

  /* ---- publish ---------------------------------------------------------- */

  step("Publish");
  const drafts = await api("/drafts");
  check(drafts.body.changes.length === 1, `1 change waiting: ${drafts.body.changes[0].title}`);
  const published = await api("/drafts/publish", {
    method: "POST",
    body: JSON.stringify({ paths: [productPath], message: "Raise the price" }),
  });
  check(published.status === 200 && published.body.action === "publish", "published");
  const head = github.log()[0];
  check(
    head.message === "Raise the price" && head.author.email === "ana@shop.test",
    "one commit on main, by Ana",
  );
  check(
    github.files()[`content/${productPath}`].includes(`price: ${newPrice}`),
    "main has the new price",
  );
  check(!github.branches().includes(draftBranch), "the empty draft branch is gone");
  const after = await api(
    `/entries?collection=products&q=${encodeURIComponent(entry.body.data.title)}`,
  );
  check(
    after.body.items[0]?.fields.price === newPrice,
    "the list shows the published price before any redeploy",
  );

  console.log("\nHosted writes work end to end.");

  // E2E_KEEP=1 leaves both servers up to walk the same flow in a browser.
  if (process.env.E2E_KEEP) {
    const again = execFileSync(
      "node",
      [
        cli,
        "studio",
        "invite",
        "ben@shop.test",
        "--name",
        "Ben Ode",
        "--role",
        "contributor",
        "--url",
        origin,
      ],
      { cwd: site, env, encoding: "utf8" },
    ).match(/https?:\/\/\S+/)?.[0];
    console.log(
      `\nStudio:  ${origin}/studio/\nEditor:  ${link}\nContributor: ${again}\nCtrl-C to stop.`,
    );
    await new Promise((resolve) => process.once("SIGINT", resolve));
  }
} catch (error) {
  console.error(error);
  console.error(log);
  process.exitCode = 1;
} finally {
  await cleanup();
}
