/**
 * The GitHub store from the environment, or undefined when it is not
 * configured. One place reads these names, so `graft serve`, `graft mcp` and
 * a framework mount all agree on them.
 */
import { relative, sep } from "node:path";
import { GraftError } from "@usegraft/contracts";
import type { PublishMode } from "../types";
import { appAuth, tokenAuth, type GitHubAuth } from "./auth";
import { GitHubStore } from "./store";

/**
 * Where a host says which commit a deployment was built from, in the order
 * `deployedShaFrom` tries them.
 */
export const DEPLOYED_SHA_ENV = [
  "GRAFT_DEPLOYED_SHA",
  "VERCEL_GIT_COMMIT_SHA",
  "RENDER_GIT_COMMIT",
  "RAILWAY_GIT_COMMIT_SHA",
  "COMMIT_REF",
  "GITHUB_SHA",
] as const;

/** Every variable the store reads, for docs and for allowlisting a server's environment. */
export const GITHUB_STORE_ENV = [
  "GRAFT_GITHUB_REPO",
  "GRAFT_GITHUB_BRANCH",
  "GRAFT_GITHUB_CONTENT_PATH",
  "GRAFT_GITHUB_TOKEN",
  "GRAFT_GITHUB_APP_ID",
  "GRAFT_GITHUB_APP_PRIVATE_KEY",
  "GRAFT_GITHUB_APP_INSTALLATION_ID",
  "GRAFT_GITHUB_API_URL",
  "GRAFT_STUDIO_PUBLISH",
  ...DEPLOYED_SHA_ENV,
] as const;

export interface GitHubStoreFromEnvOptions {
  /** Absolute content directory; its path under `projectRoot` is the default content path. */
  contentDir: string;
  /** Absolute project root. Defaults to the process working directory. */
  projectRoot?: string;
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
}

export function githubStoreFromEnv(options: GitHubStoreFromEnvOptions): GitHubStore | undefined {
  const env = options.env ?? process.env;
  const repo = env.GRAFT_GITHUB_REPO?.trim();
  if (!repo) return undefined;

  const apiUrl = env.GRAFT_GITHUB_API_URL?.trim() || undefined;
  let auth: GitHubAuth;
  if (env.GRAFT_GITHUB_APP_ID?.trim() && env.GRAFT_GITHUB_APP_PRIVATE_KEY?.trim()) {
    auth = appAuth({
      appId: env.GRAFT_GITHUB_APP_ID.trim(),
      privateKey: env.GRAFT_GITHUB_APP_PRIVATE_KEY,
      installationId: env.GRAFT_GITHUB_APP_INSTALLATION_ID?.trim() || undefined,
      repo,
      apiUrl,
      fetch: options.fetch,
    });
  } else if (env.GRAFT_GITHUB_TOKEN?.trim()) {
    auth = tokenAuth(env.GRAFT_GITHUB_TOKEN.trim());
  } else {
    throw new GraftError({
      code: "ENV_VAR_MISSING",
      message: "GRAFT_GITHUB_REPO is set, but there is no credential to write to it.",
      fix: "Set GRAFT_GITHUB_TOKEN (a fine-grained token with Contents and Pull requests read/write on the repository), or GRAFT_GITHUB_APP_ID and GRAFT_GITHUB_APP_PRIVATE_KEY for a GitHub App.",
      details: { repo },
    });
  }

  const publish = env.GRAFT_STUDIO_PUBLISH?.trim() || "commit";
  if (publish !== "commit" && publish !== "pull-request") {
    throw new GraftError({
      code: "CONFIG_INVALID",
      message: `GRAFT_STUDIO_PUBLISH is "${publish}".`,
      fix: 'Use "commit" (publishing commits to the branch) or "pull-request" (publishing opens a pull request).',
    });
  }
  const publishMode: PublishMode = publish === "commit" ? "direct" : "review";

  const root = options.projectRoot ?? process.cwd();
  const inferred = relative(root, options.contentDir).split(sep).join("/");
  // Inside the project, the content directory sits at the same place in the
  // repository (the project root itself is ""). Outside it, guess `content`.
  const contentPath =
    env.GRAFT_GITHUB_CONTENT_PATH?.trim() ?? (inferred.startsWith("..") ? "content" : inferred);

  return new GitHubStore({
    repo,
    auth,
    branch: env.GRAFT_GITHUB_BRANCH?.trim() || "main",
    contentPath,
    publishMode,
    deployedSha: deployedShaFrom(env),
    apiUrl,
    fetch: options.fetch,
  });
}

/** The commit the running deployment was built from, from the host's own variable. */
export function deployedShaFrom(env: Record<string, string | undefined>): string | undefined {
  for (const name of DEPLOYED_SHA_ENV) {
    const value = env[name]?.trim();
    if (value && /^[0-9a-f]{40}$/.test(value)) return value;
  }
  return undefined;
}
