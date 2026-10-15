/**
 * Assert that `latest` on npm points where a bare install should land.
 *
 * `npm i @usegraft/core` resolves the `latest` dist-tag, and that tag is the
 * one thing about a release the repository cannot see. `changeset publish` in
 * pre mode publishes to `beta` and does not touch `latest`, so `latest` keeps
 * pointing at whatever it pointed at before — forever, silently, while every
 * README describes the version it is not.
 *
 * That is not hypothetical. Moving `latest` onto the prerelease line was done
 * by hand once, at 1.0.0-beta.0, and written up as a property "kept by moving
 * the tag at release". Nothing did the moving. beta.1 published cleanly, the
 * workflow went green, and `latest` stayed on beta.0 across all 21 packages —
 * so the release the docs described was one a plain install could not get, and
 * `npx @usegraft/cli@latest` fetched the older CLI.
 *
 * release.yml now moves the tag itself with sync-dist-tags.mjs, over OIDC, and
 * runs this afterwards. The move and the check stay separate: the sync reports
 * what it attempted, and this reads the registry back. If the move failed, this
 * keeps the build red and prints the command that finishes it by hand.
 */
import {
  fetchDistTags,
  publishablePackages,
  releaseChannel,
  releaseVersion,
} from "./lib/workspace.mjs";

const packages = publishablePackages();
if (packages.length === 0) {
  console.error("Found no publishable workspace packages. Refusing to guess.");
  process.exit(1);
}

let version;
try {
  version = releaseVersion(packages);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const { name: channelName, tags: shouldPoint } = releaseChannel();

// `--settle <seconds>`: keep re-reading while tags still drift, up to this long.
// release.yml reads straight after sync-dist-tags writes, and the registry's
// read side lags its writes. The first OIDC run moved all 22 tags and this
// check still saw four on the old version seconds later. Without the flag a
// drift fails at once, which is right for a check run by hand.
const settleArg = process.argv.indexOf("--settle");
const settleSeconds = settleArg === -1 ? 0 : Number(process.argv[settleArg + 1]);
if (!Number.isFinite(settleSeconds) || settleSeconds < 0) {
  console.error("--settle takes a number of seconds.");
  process.exit(1);
}

// Read in parallel: 21 sequential `npm view` subprocesses took over four
// minutes and were timing out. These are plain GETs, so they cost seconds.
async function readRegistry() {
  const drift = [];
  const absent = [];
  const unreadable = [];
  const results = await Promise.all(packages.map((pkg) => fetchDistTags(pkg.name)));
  for (const [i, pkg] of packages.entries()) {
    const result = results[i];
    if (result.kind === "absent") {
      absent.push(pkg.name);
      continue;
    }
    if (result.kind === "failed") {
      unreadable.push({ name: pkg.name, reason: result.reason });
      continue;
    }
    for (const tag of shouldPoint) {
      if (result.tags[tag] !== version) {
        drift.push({ name: pkg.name, tag, points: result.tags[tag] ?? "(unset)" });
      }
    }
  }
  return { drift, absent, unreadable };
}

const deadline = Date.now() + settleSeconds * 1000;
let { drift, absent, unreadable } = await readRegistry();
while (drift.length > 0 && unreadable.length === 0 && Date.now() < deadline) {
  console.log(`${drift.length} tag(s) not updated yet. Reading again in 10s.`);
  await new Promise((resolve) => setTimeout(resolve, 10_000));
  ({ drift, absent, unreadable } = await readRegistry());
}

if (absent.length > 0) {
  console.log(`Not on the registry yet, so nothing to check: ${absent.join(", ")}`);
}

// Reported before drift, and fatal on its own. Saying "OK" about the packages
// that answered, while others went unread, is the one output this script must
// never produce — it is the exact shape of the bug it was written to catch.
if (unreadable.length > 0) {
  console.error(`\nCould not read dist-tags for ${unreadable.length} package(s):\n`);
  for (const u of unreadable) console.error(`  ${u.name}  ${u.reason}`);
  console.error(
    "\nThis is not a passing check with gaps — it is a check that did not run." +
      "\nRerun it once the registry answers.",
  );
  process.exit(1);
}

if (drift.length > 0) {
  console.error(
    `\n${drift.length} dist-tag(s) do not point at ${version}, the version this repo just released.\n`,
  );
  for (const d of drift) console.error(`  ${d.name}  ${d.tag} -> ${d.points}`);
  console.error(
    "\nA `latest` left behind is the bug that survives a green build: the release" +
      "\npublishes, the docs describe it, and a plain install still resolves the" +
      "\nolder version. In CI, check that each package's trusted publisher has" +
      '\n"Allow npm dist-tag" ticked. Or finish it by hand, logged in:\n',
  );
  for (const d of drift) console.error(`  npm dist-tag add ${d.name}@${version} ${d.tag}`);
  console.error("");
  process.exit(1);
}

console.log(
  `dist-tags: OK — ${shouldPoint.join(" and ")} point at ${version} on all ${packages.length - absent.length} published package(s) (${channelName} channel).`,
);
