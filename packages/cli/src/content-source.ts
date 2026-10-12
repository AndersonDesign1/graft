/**
 * What a project's content source decides for the CLI: which store a writing
 * surface mounts, and which commands have nothing to act on.
 */
import { GraftError } from "@usegraft/contracts";
import type { ContentStore, MirrorResult } from "@usegraft/compiler";
import type { Database } from "@usegraft/db";
import type { ProjectConfig } from "./config";

/**
 * The database store for a database-sourced project, or undefined when the
 * files in git are the source and today's stores apply.
 */
export async function databaseStoreFor(
  config: ProjectConfig,
  db: Database,
  branchId: string,
): Promise<ContentStore | undefined> {
  if (config.content.source !== "database") return undefined;
  const { DatabaseStore } = await import("@usegraft/compiler");
  const mirror =
    config.content.mirror?.mode === "each" ? await mirrorFor(config, db, branchId) : undefined;
  return new DatabaseStore({
    db,
    branchId,
    collections: config.collections,
    mdxTrust: config.mdxTrust,
    ...(mirror ? { onPublished: () => mirror().then(() => undefined) } : {}),
  });
}

/**
 * A function that commits what was published since the last run, when the
 * project mirrors to git and a repository is configured. Warns once and
 * returns undefined when the repository variables are missing, because the
 * content is live either way and the mirror is a record.
 */
export async function mirrorFor(
  config: ProjectConfig,
  db: Database,
  branchId: string,
): Promise<(() => Promise<MirrorResult>) | undefined> {
  if (config.content.source !== "database" || !config.content.mirror) return undefined;
  const { githubStoreFromEnv, mirrorToGit } = await import("@usegraft/compiler");
  const github = githubStoreFromEnv({
    contentDir: config.contentDir,
    projectRoot: config.projectDir,
  });
  if (!github) {
    console.warn(
      "graft: content.mirror is set, but GRAFT_GITHUB_REPO is not, so nothing is mirrored to git. Set it and GRAFT_GITHUB_TOKEN (or the GitHub App variables).",
    );
    return undefined;
  }
  const via = config.content.mirror.via ?? "commit";
  return async () => {
    const result = await mirrorToGit({ db, github, branchId, via });
    if (result.status === "mirrored") {
      // stderr: under `graft mcp`, stdout is the protocol stream.
      console.error(
        `graft: mirrored ${result.paths.length} change(s) to git${result.commit ? `: ${result.commit.url}` : ""}`,
      );
    }
    return result;
  };
}

/**
 * For `mode: "batch"` under a long-running server: mirror every
 * `everyMinutes` (default 60). Returns a stop function.
 */
export async function startMirrorSchedule(
  config: ProjectConfig,
  db: Database,
  branchId: string,
): Promise<() => void> {
  if (config.content.mirror?.mode !== "batch") return () => {};
  const run = await mirrorFor(config, db, branchId);
  if (!run) return () => {};
  const minutes = config.content.mirror.everyMinutes ?? 60;
  const timer = setInterval(() => {
    run().catch((error: unknown) => {
      console.error(`graft: mirror: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, minutes * 60_000);
  timer.unref();
  return () => clearInterval(timer);
}

/** Refuse a command that reads or rewrites files, in a project whose files are not the source. */
export function assertGitSourced(config: ProjectConfig, what: string, fix: string): void {
  if (config.content.source !== "database") return;
  throw new GraftError({
    code: "CONTENT_SOURCE_MISMATCH",
    message: `This project keeps its content in the database, so ${what} has nothing to act on.`,
    fix,
    details: { source: config.content.source },
  });
}
