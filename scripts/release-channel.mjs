/**
 * Which channel the next release goes to, and a guard so nobody finds out by
 * accident.
 *
 * Graft has three, and they answer different questions:
 *
 *   canary   0.0.0-canary-<timestamp>   "does this commit work?"
 *   beta     1.0.0-beta.N               "is the next version ready?"
 *   stable   1.0.0                      "it is ready."
 *
 * A canary is a snapshot: version 0.0.0 forever, sorts BELOW every real
 * release, never offered as an upgrade, and no path from it to a stable
 * version. It is a build you hand someone, not a channel they subscribe to.
 *
 * Beta is changesets prerelease mode, which is stateful — `.changeset/pre.json`
 * is committed, and while it exists EVERY release off this branch is a
 * prerelease. release.yml's own comment names that as the reason pre mode was
 * avoided: feat/core takes every ordinary push, so entering pre mode puts all
 * of it into prerelease versioning "until someone remembered to exit".
 *
 * That is the failure this script exists to make impossible. The state is
 * committed (so it appears in a diff and a review, like approvalPolicy), and CI
 * prints the active channel on every run, so "we were still in beta" cannot be
 * discovered at publish time.
 *
 *   node scripts/release-channel.mjs            report the channel
 *   node scripts/release-channel.mjs --assert-stable
 *                                               exit 1 if not stable
 *
 * Enter and exit with `pnpm release:beta-enter` / `pnpm release:beta-exit`,
 * which are thin wrappers over `changeset pre enter beta` / `changeset pre exit`.
 * Both write `.changeset/pre.json`; commit it.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const preJson = resolve(import.meta.dirname, "..", ".changeset", "pre.json");
const assertStable = process.argv.includes("--assert-stable");

if (!existsSync(preJson)) {
  console.log("release channel: stable — the next release publishes to the `latest` dist-tag.");
  process.exit(0);
}

let pre;
try {
  pre = JSON.parse(readFileSync(preJson, "utf8"));
} catch (error) {
  console.error(
    `release channel: .changeset/pre.json exists but is not readable JSON — ${error.message}`,
  );
  process.exit(1);
}

// `mode: "exit"` is what `changeset pre exit` leaves behind: the file stays so
// the next `changeset version` can graduate the accumulated prereleases, and it
// means stable, not beta. Reading only `tag` would call that beta and be wrong.
if (pre.mode === "exit") {
  console.log(
    `release channel: stable (exiting "${pre.tag}") — the next release graduates the accumulated ` +
      "prereleases to a stable version on `latest`.",
  );
  process.exit(0);
}

const changesets = Array.isArray(pre.changesets) ? pre.changesets.length : 0;
console.log(
  `release channel: ${pre.tag} — PRERELEASE MODE IS ON.\n` +
    `  Every release off this branch publishes to the \`${pre.tag}\` dist-tag, not \`latest\`.\n` +
    `  ${changesets} changeset(s) accumulated so far.\n` +
    `  Graduate with \`pnpm release:beta-exit\`, then merge the version PR.`,
);

if (assertStable) {
  console.error(
    "\nRefusing: this step requires the stable channel, and the repository is in " +
      `"${pre.tag}" prerelease mode.`,
  );
  process.exit(1);
}
