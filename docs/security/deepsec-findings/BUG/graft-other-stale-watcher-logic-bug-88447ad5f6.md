# [BUG] Content-dir watcher not refreshed after graft.config reload changes contentDir

**File:** [`packages/cli/src/commands/dev.ts`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/packages/cli/src/commands/dev.ts#L73-L114) (lines 73, 77, 114)
**Project:** graft
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-stale-watcher-logic-bug`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

`devCommand` creates its FSWatchers once at startup (line 114) bound to the initially resolved `config.contentDir`. When graft.config.ts is edited, `runCompile` sets `configDirty`, reloads the config (lines 73-77), and compiles from the NEW `config.contentDir` (lines 80-90) — but the watcher still monitors the OLD directory. After a config edit that relocates `contentDir`, every subsequent MDX edit in the new location is invisible to the watcher: no debounce fires, no recompile happens, and `graft dev` silently stalls in the edit->compile loop it exists to serve. The same staleness applies if `projectDir` semantics changed. Not a security issue (local operator tooling, no trust boundary crossed), but a real logic inconsistency: compile reads one directory while watching another.

## Recommendation

After reloading config in runCompile, compare the new contentDir (and projectDir) against the currently watched paths; if changed, close and recreate the FSWatchers on the new directories.

## Revalidation

**Verdict:** true-positive

Verified in dev.ts: FSWatcher instances are created once after the initial runCompile (watch(config.contentDir, {recursive:true}, ...) and watch(config.projectDir, ...)) capturing the directory strings resolved from the startup-time config object. Inside runCompile, when configDirty is set the code reassigns the module-level let config = await loadConfig(configPath) and compiles from the NEW config.contentDir/config.collections — but the watchers are never closed/recreated, so they keep polling the OLD paths. After a graft.config.ts edit that relocates contentDir, MDX saves in the new location generate no watcher event, schedule() never fires, and the debounce→compile loop silently stalls even though compile would succeed if invoked (the config watcher still fires on further config edits, but pure content edits do not). The mismatch — compile reading one tree while watching another — is a genuine logic inconsistency. Correctly classified as a non-security correctness bug (local operator tooling, no trust boundary crossed): BUG severity, true positive.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-10)
