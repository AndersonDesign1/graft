/**
 * The dev loop a generated site runs as `npm run dev`, checked in a compat
 * app: `graft dev -- <dev server>` serves a page, an edit to its content file
 * shows on the next request with no restart, and Ctrl+C stops both.
 *
 * Shared by the sdk-next, sdk-nuxt and sdk-sveltekit compat smokes, after
 * their production checks. Linux and macOS only: it stops graft dev with
 * SIGINT, which Windows has no way to send.
 */
import { spawn } from "node:child_process";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The page without the comment markers frameworks put inside elements. */
async function page(url) {
  try {
    const response = await fetch(url);
    let html = await response.text();
    let previous;
    do {
      previous = html;
      html = previous.replace(/<!--[\s\S]*?-->/g, "");
    } while (html !== previous);
    return html;
  } catch {
    return "";
  }
}

async function waitFor(url, text, seconds) {
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    if ((await page(url)).includes(text)) return true;
    await sleep(250);
  }
  return false;
}

/**
 * @param {object} options
 * @param {string} options.appDir The compat app, with its content already compiled.
 * @param {string[]} options.devServer The dev server command, as the generated dev script names it.
 * @param {string} options.url A page that shows `before`.
 * @param {string} options.file The content file, relative to appDir.
 * @param {[string, string]} options.edit The text in `file` to replace, and what with.
 * @param {string} options.before What `url` shows before the edit.
 * @param {string} options.after What it shows after.
 * @param {(ok: boolean, what: string) => void} options.check
 */
export async function checkDevLoop(options) {
  const { appDir, devServer, url, file, edit, before, after } = options;
  if (process.platform === "win32") return;
  let failed = false;
  const check = (ok, what) => {
    if (!ok) failed = true;
    options.check(ok, what);
  };
  const cliDir = realpathSync(join(appDir, "node_modules/@usegraft/cli"));
  const { bin } = JSON.parse(readFileSync(join(cliDir, "package.json"), "utf8"));
  const cli = join(cliDir, typeof bin === "string" ? bin : bin.graft);
  const output = [];
  // As `npm run dev` would: the app's own binaries first on PATH.
  const dev = spawn(process.execPath, [cli, "dev", "--", ...devServer], {
    cwd: appDir,
    env: {
      ...process.env,
      PATH: `${join(appDir, "node_modules/.bin")}${delimiter}${process.env.PATH}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [dev.stdout, dev.stderr]) stream.on("data", (chunk) => output.push(chunk));
  const exited = new Promise((resolve) => dev.once("exit", (code) => resolve(code)));
  const path = join(appDir, file);
  const original = readFileSync(path, "utf8");
  try {
    const up = await waitFor(url, before, 180);
    check(up, `graft dev -- ${devServer.join(" ")} serves the page`);
    if (!up) return;
    writeFileSync(path, original.replace(edit[0], edit[1]));
    const started = Date.now();
    const shown = await waitFor(url, after, 30);
    check(
      shown,
      `an edit to ${file} shows on the next request, no restart${shown ? ` (${Date.now() - started} ms)` : ""}`,
    );
  } finally {
    writeFileSync(path, original);
    dev.kill("SIGINT");
    const code = await Promise.race([exited, sleep(30_000).then(() => "running")]);
    check(code === 0, `Ctrl+C stops graft dev with 0 (got ${code})`);
    if (code === "running") dev.kill("SIGKILL");
    check(!(await page(url)), "and the dev server with it");
    if (failed) console.log(`graft dev printed:\n${Buffer.concat(output).toString().slice(-4000)}`);
  }
}
