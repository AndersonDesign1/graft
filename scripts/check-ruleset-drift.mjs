/**
 * `.github/rulesets/*.json` is a RECORD of branch protection, not a mechanism
 * that applies it. Rulesets live in repository settings, and a change made in
 * the web UI leaves no diff anywhere — which is the whole reason that directory
 * exists, and also its weakness: the record is only true while someone keeps
 * checking it by hand. The README said "checked 2026-08-31", which is a claim
 * with a shelf life.
 *
 * This turns that claim into a job. It asserts every rule the committed file
 * DECLARES is in force on the live ruleset, so relaxing protection in the UI
 * fails CI.
 *
 * Deliberately one-directional. It does not apply the file, because a commit
 * that could rewrite branch protection is a commit that could remove it — the
 * file must be able to fail the build without being able to weaken the branch.
 * And it compares only declared fields, so GitHub adding a default to its own
 * API (it already returns `required_reviewers` and
 * `require_extra_approval_for_unattributed_changes` that we never wrote) does
 * not fail an unrelated pull request.
 *
 * Needs a token with `administration: read`. Without one the API 403s or 404s,
 * and the check SKIPS rather than fails: a fork's pull request cannot read the
 * upstream's settings and must not be blocked on that.
 *
 * Run: node scripts/check-ruleset-drift.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dir = join(root, ".github", "rulesets");
const repo = process.env.GITHUB_REPOSITORY ?? "AndersonDesign1/graft";
const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;

const api = async (path) => {
  const headers = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`https://api.github.com${path}`, { headers });
  return { ok: response.ok, status: response.status, body: await response.json() };
};

const skip = (why) => {
  console.log(`ruleset drift: SKIPPED — ${why}`);
  process.exit(0);
};

const listed = await api(`/repos/${repo}/rulesets`);
if (!listed.ok) {
  // 403/404 is the ordinary answer for a fork or a token without
  // administration:read. Anything else is a real failure worth surfacing.
  if (listed.status === 403 || listed.status === 404) {
    skip(
      `cannot read rulesets for ${repo} (HTTP ${listed.status}); needs a token with administration: read`,
    );
  }
  console.error(`ruleset drift: GitHub returned HTTP ${listed.status} listing rulesets.`);
  process.exit(1);
}

const live = new Map(listed.body.map((entry) => [entry.name, entry]));
const problems = [];
const checked = [];

/** Every key the record declares must match, by value. Extra live keys are fine. */
const declaredMatches = (want, got, path) => {
  for (const [key, value] of Object.entries(want)) {
    const here = `${path}.${key}`;
    const actual = got?.[key];
    if (Array.isArray(value)) {
      // Order-insensitive: the API does not promise the order it stores these,
      // and a reordered required-check list is not a policy change.
      const a = JSON.stringify([...value].map((v) => JSON.stringify(v)).sort());
      const b = JSON.stringify([...(actual ?? [])].map((v) => JSON.stringify(v)).sort());
      if (a !== b) problems.push(`${here}: recorded ${a}, live ${b}`);
    } else if (value !== null && typeof value === "object") {
      declaredMatches(value, actual ?? {}, here);
    } else if (actual !== value) {
      problems.push(`${here}: recorded ${JSON.stringify(value)}, live ${JSON.stringify(actual)}`);
    }
  }
};

for (const file of readdirSync(dir)) {
  if (!file.endsWith(".json")) continue;
  const recorded = JSON.parse(readFileSync(join(dir, file), "utf8"));
  const entry = live.get(recorded.name);
  if (!entry) {
    problems.push(`${file}: no live ruleset named "${recorded.name}" — the branch is unprotected`);
    continue;
  }

  const full = await api(`/repos/${repo}/rulesets/${entry.id}`);
  if (!full.ok) {
    problems.push(`${file}: HTTP ${full.status} reading ruleset ${entry.id}`);
    continue;
  }

  // Unauthenticated, or with a token lacking administration: read, this
  // endpoint answers 200 with `rules` and simply OMITS `bypass_actors`. That is
  // the worst possible shape for a check: it would compare rules, find them
  // fine, never compare the actors who can ignore those rules, and print OK.
  // An absent key is "not allowed to look", which is not the same as "there are
  // none" — so the whole check stops rather than reporting a pass it did not earn.
  if (!Object.hasOwn(full.body, "bypass_actors")) {
    skip(
      `GitHub returned ruleset ${entry.id} without bypass_actors, so this token cannot see who ` +
        `can bypass. Rules alone are not enough to call the record verified. Needs administration: read.`,
    );
  }

  checked.push(`${file} -> "${recorded.name}" (${entry.id})`);
  if (recorded.enforcement !== full.body.enforcement) {
    problems.push(
      `${file}: enforcement recorded ${recorded.enforcement}, live ${full.body.enforcement}`,
    );
  }

  const liveRules = new Map((full.body.rules ?? []).map((rule) => [rule.type, rule]));
  for (const rule of recorded.rules ?? []) {
    const liveRule = liveRules.get(rule.type);
    if (!liveRule) {
      problems.push(`${file}: rule "${rule.type}" is recorded but not live`);
      continue;
    }
    if (rule.parameters) {
      declaredMatches(rule.parameters, liveRule.parameters ?? {}, `${file}:${rule.type}`);
    }
  }

  // Bypass actors widen who can ignore every rule above. A LIVE one missing
  // from the record is the dangerous direction — someone granted a bypass in
  // the UI and nothing shows it. A RECORDED one that is not live is harmless to
  // the branch but makes the record a lie, and this file's only job is being
  // true. Both are reported, in the order of how much they matter.
  const key = (actor) => `${actor.actor_type}:${actor.actor_id}:${actor.bypass_mode}`;
  const recordedBypass = new Set((recorded.bypass_actors ?? []).map(key));
  const liveBypass = new Set((full.body.bypass_actors ?? []).map(key));
  for (const actor of liveBypass) {
    if (!recordedBypass.has(actor)) {
      problems.push(
        `${file}: live bypass actor ${actor} is NOT in the record — a bypass nobody wrote down`,
      );
    }
  }
  for (const actor of recordedBypass) {
    if (!liveBypass.has(actor)) {
      problems.push(`${file}: recorded bypass actor ${actor} is not live — the record is stale`);
    }
  }
}

if (problems.length > 0) {
  console.error("ruleset drift: the record and GitHub disagree.\n");
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(
    "\nEither GitHub was changed without updating .github/rulesets/, or the file was" +
      "\nchanged without importing it (Settings -> Rules -> Rulesets -> ... -> Import)." +
      "\nThe record is documentation; GitHub is what actually protects the branch.",
  );
  process.exit(1);
}

console.log(`ruleset drift: OK — ${checked.length} checked`);
for (const line of checked) console.log(`  ${line}`);
