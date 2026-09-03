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
 * The fix has to be a check rather than an action: this pipeline publishes
 * through OIDC trusted publishing and holds no npm token, and OIDC authorises
 * `npm publish` alone — `npm dist-tag add` needs a credential the workflow
 * deliberately does not have. So CI cannot move the tag. What it can do is
 * refuse to call a release finished when the tag did not move, and print the
 * command that finishes it. A wrong `latest` is now a red build instead of a
 * fact nobody learns from the repository.
 */
import { execSync } from "node:child_process";
import { NPM_NAME, publishablePackages, releaseChannel, releaseVersion } from "./lib/workspace.mjs";

/**
 * What the registry says about one package, as one of three distinct answers.
 *
 * Collapsing these was this file's own first bug, and it was the same bug the
 * file exists to catch one level up: a lookup that did not happen must not read
 * as a lookup that found nothing wrong. `catch { return null }` gave a dead
 * network, a proxy error, an expired credential and malformed output the same
 * value as "not published yet" — and the loop skips packages that are not
 * published, so a registry outage printed `dist-tags: OK` and exited 0. The
 * check would have been most reassuring exactly when it could see least.
 *
 * A genuine absence is identified rather than assumed: `npm view --json`
 * answers a missing package with an `error.code` of `E404` on stdout. That
 * shape, and only that shape, means absent. Everything else is a failure to
 * look, and a failure to look is reported.
 */
function lookUp(name) {
  if (!NPM_NAME.test(name)) {
    return { kind: "failed", reason: `not a package name npm would accept: ${name}` };
  }
  let stdout;
  try {
    stdout = execSync(`npm view ${name} dist-tags --json`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const body = typeof error.stdout === "string" ? error.stdout : "";
    try {
      const parsed = JSON.parse(body);
      if (parsed?.error?.code === "E404") return { kind: "absent" };
      return { kind: "failed", reason: parsed?.error?.summary ?? `npm exited ${error.status}` };
    } catch {
      // No JSON at all: npm did not get far enough to answer.
      const stderr = typeof error.stderr === "string" ? error.stderr.trim() : "";
      const firstLine = stderr.split(/\r?\n/)[0];
      return { kind: "failed", reason: firstLine || `npm exited ${error.status}` };
    }
  }

  let tags;
  try {
    tags = JSON.parse(stdout);
  } catch {
    return { kind: "failed", reason: "npm exited 0 but its --json output did not parse" };
  }
  // Exit 0 carrying something that is not a tag map is still not an answer.
  if (tags === null || typeof tags !== "object" || Array.isArray(tags)) {
    return { kind: "failed", reason: "npm returned JSON that is not a dist-tag map" };
  }
  return { kind: "tags", tags };
}

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
const drift = [];
const absent = [];
const unreadable = [];

for (const pkg of packages) {
  const result = lookUp(pkg.name);
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
      "\nolder version. OIDC trusted publishing cannot move a tag, so this is" +
      "\nfinished by hand, from an account with publish rights:\n",
  );
  for (const d of drift) console.error(`  npm dist-tag add ${d.name}@${version} ${d.tag}`);
  console.error("");
  process.exit(1);
}

console.log(
  `dist-tags: OK — ${shouldPoint.join(" and ")} point at ${version} on all ${packages.length - absent.length} published package(s) (${channelName} channel).`,
);
