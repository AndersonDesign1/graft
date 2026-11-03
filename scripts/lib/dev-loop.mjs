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
async function page(url, until = Date.now() + 10_000) {
  try {
    // A server that accepts a request and stalls must not hold the smoke past its deadline.
    const left = Math.max(1, Math.min(10_000, until - Date.now()));
    const response = await fetch(url, { signal: AbortSignal.timeout(left) });
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

/** Polls until `url` shows `text`, the time is up, or `gone()` says the process has exited. */
async function waitFor(url, text, seconds, gone = () => false) {
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until && !gone()) {
    if ((await page(url, until)).includes(text)) return true;
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
  if (process.platform === "win32") {
    console.log(
      "skip the dev loop check: it stops graft dev with SIGINT, which Windows cannot send",
    );
    return;
  }
  let failed = false;
  const check = (ok, what) => {
    if (!ok) failed = true;
    options.check(ok, what);
  };
  const cliDir = realpathSync(join(appDir, "node_modules/@usegraft/cli"));
  const { bin } = JSON.parse(readFileSync(join(cliDir, "package.json"), "utf8"));
  const cli = join(cliDir, typeof bin === "string" ? bin : bin.graft);
  const path = join(appDir, file);
  const original = readFileSync(path, "utf8");
  const output = [];
  // As `npm run dev` would: the app's own binaries first on PATH.
  const dev = spawn(process.execPath, [cli, "dev", "--", ...devServer], {
    cwd: appDir,
    env: {
      ...process.env,
      PATH: `${join(appDir, "node_modules/.bin")}${delimiter}${process.env.PATH}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
    // Its own process group, so the last-resort kill below takes the dev server too.
    detached: true,
  });
  for (const stream of [dev.stdout, dev.stderr]) stream.on("data", (chunk) => output.push(chunk));
  let gone = false;
  const exited = new Promise((resolve) =>
    dev.once("exit", (code) => {
      gone = true;
      resolve(code);
    }),
  );
  try {
    const up = await waitFor(url, before, 180, () => gone);
    check(up, `graft dev -- ${devServer.join(" ")} serves the page`);
    if (!up) return;
    writeFileSync(path, original.replace(edit[0], edit[1]));
    const started = Date.now();
    const shown = await waitFor(url, after, 30, () => gone);
    check(
      shown,
      `an edit to ${file} shows on the next request, no restart${shown ? ` (${Date.now() - started} ms)` : ""}`,
    );
  } finally {
    writeFileSync(path, original);
    // Exited on its own before Ctrl+C: a failure, but not a failed Ctrl+C.
    if (gone) {
      check(false, `graft dev exited on its own, with ${dev.exitCode ?? dev.signalCode}`);
      console.log(`graft dev printed:\n${Buffer.concat(output).toString().slice(-4000)}`);
      return;
    }
    dev.kill("SIGINT");
    let timer;
    const code = await Promise.race([
      exited,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve("running"), 30_000);
      }),
    ]);
    clearTimeout(timer);
    check(code === 0, `Ctrl+C stops graft dev with 0 (got ${code})`);
    if (code === "running") process.kill(-dev.pid, "SIGKILL");
    check(!(await page(url)), "and the dev server with it");
    if (failed) console.log(`graft dev printed:\n${Buffer.concat(output).toString().slice(-4000)}`);
  }
}
