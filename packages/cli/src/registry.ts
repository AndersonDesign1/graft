/**
 * Every graft command, as data: what it is called, what it takes, and how it
 * behaves. Help, flag checking, `graft commands --json` and the generated CLI
 * reference all read this table, so they cannot disagree with each other.
 *
 * Data only. Nothing here may import code at runtime: `graft --help` loads
 * this file and nothing else, and has to stay as fast as Node starting. The
 * code each command runs lives in handlers.ts, keyed by the command's id.
 */

export type FlagType = "boolean" | "string" | "number";

export interface FlagSpec {
  /** Long name without the dashes: "branch" is --branch. */
  readonly name: string;
  /** One letter: "b" is -b. */
  readonly short?: string;
  readonly type: FlagType;
  /** What the value looks like in usage, such as "<id>" or "overlay|neon". */
  readonly value?: string;
  /** A real value, shown when the flag is given without one. */
  readonly example?: string;
  /** May be given more than once; the values are collected in order. */
  readonly multiple?: boolean;
  /** An environment variable that sets the same thing. */
  readonly env?: string;
  readonly summary: string;
}

export interface ArgSpec {
  readonly name: string;
  readonly required?: boolean;
  /** Takes every remaining argument. */
  readonly variadic?: boolean;
}

/** Whether a command needs DATABASE_URL. */
export type DatabaseNeed = "always" | "postgres" | "optional" | "never";

export interface ExitCodeSpec {
  readonly code: number;
  readonly meaning: string;
}

export const GROUPS = {
  start: "Set up a project",
  content: "Write and check content",
  project: "Look into the project",
  run: "Run Graft",
  sync: "Keep content in the database",
  database: "Manage the database",
  approvals: "Approve actions",
  branches: "Work with preview branches",
  ci: "Keep CI cheap",
  remote: "Work with a hosted site",
  help: "Learn the CLI",
} as const;

export type Group = keyof typeof GROUPS;

export interface CommandSpec {
  /** The words that name it: ["branch", "create"] is `graft branch create`. */
  readonly path: readonly string[];
  /** One line, for lists and tables. */
  readonly summary: string;
  /** More about what it does, shown in its own help. */
  readonly description?: readonly string[];
  readonly group: Group;
  readonly args?: readonly ArgSpec[];
  readonly flags: readonly FlagSpec[];
  /** Takes --json: one JSON object on stdout, everything else on stderr. */
  readonly json?: boolean;
  readonly database: DatabaseNeed;
  /** Can stop to ask a question; takes --no-input. */
  readonly interactive?: boolean;
  /** Works on a hosted site too; takes --remote and --local. */
  readonly remote?: boolean;
  /** Runs until stopped, so the update notice prints as soon as it is known. */
  readonly longRunning?: boolean;
  /** False when stdout belongs to a protocol, as with `graft mcp`. */
  readonly updateCheck?: boolean;
  /** Codes this command uses differently from the shared ones. */
  readonly exitCodes?: readonly ExitCodeSpec[];
  readonly examples?: readonly string[];
}

/* ---- flags used by more than one command -------------------------------- */

const BRANCH: FlagSpec = {
  name: "branch",
  short: "b",
  type: "string",
  value: "<id>",
  example: "main",
  summary: "Content branch to work on (default: main)",
};
const DRY_RUN: FlagSpec = {
  name: "dry-run",
  type: "boolean",
  summary: "Show what would change without changing it",
};
const APPLY: FlagSpec = {
  name: "apply",
  type: "boolean",
  summary: "Make the change (without it, only report what would change)",
};
const PORT = (fallback: string, env: string): FlagSpec => ({
  name: "port",
  type: "number",
  value: "<n>",
  example: fallback,
  env,
  summary: `Port to listen on (default: ${fallback})`,
});
const HOST: FlagSpec = {
  name: "host",
  type: "string",
  value: "<host>",
  example: "127.0.0.1",
  env: "HOST",
  summary: "Host to listen on (default: 127.0.0.1, this computer only)",
};
const OVERWRITE: FlagSpec = {
  name: "overwrite",
  type: "boolean",
  summary: "Replace what is already there",
};
const BASE: FlagSpec = {
  name: "base",
  type: "string",
  value: "<ref>",
  example: "origin/main",
  summary:
    "Git ref to compare against (default: the pull request's base, the host's previous deploy, or the commit a push started from)",
};
const FORCE_SYNC: FlagSpec = {
  name: "force",
  type: "boolean",
  summary: "Settle a conflict: pull takes the published version, push publishes yours",
};
const ONLY: FlagSpec = {
  name: "only",
  type: "string",
  value: "<doc>",
  example: "posts/launch",
  multiple: true,
  summary: "Only this document, like posts/launch (same as naming it as an argument)",
};

/* ---- the commands -------------------------------------------------------- */

export const COMMANDS: readonly CommandSpec[] = [
  // Set up a project
  {
    path: ["create"],
    group: "start",
    summary: "Make a new site with a template, a database, Studio and a Next.js app",
    description: [
      "Make a new site: a template, a database, Studio and (by default) a Next.js app,",
      "installed and ready. `npm create graft` runs this. It asks a few questions;",
      "flags answer them, and --yes takes the defaults for the rest.",
    ],
    args: [{ name: "dir" }],
    flags: [
      {
        name: "template",
        type: "string",
        value: "<name>",
        example: "blog",
        summary: "blog, docs, shop, portfolio or blank (default: blog)",
      },
      {
        name: "edit",
        type: "string",
        value: "online|code",
        example: "online",
        summary:
          "online keeps content in the database, edited in Studio (default); code keeps it as files in git",
      },
      {
        name: "database",
        type: "string",
        value: "new|none|<url>",
        example: "new",
        summary:
          "new makes a free Postgres to claim later; none compiles content to a file (with --edit code); or your own Postgres 13+ URL",
      },
      {
        name: "framework",
        type: "string",
        value: "next|none",
        example: "next",
        summary:
          "next for a Next.js site that shows every collection (default); none for only the content",
      },
      {
        name: "yes",
        short: "y",
        type: "boolean",
        summary: "Use the default for every question a flag did not answer",
      },
      {
        name: "no-install",
        type: "boolean",
        summary: "Write the files and stop before installing",
      },
    ],
    database: "never",
    interactive: true,
    examples: ["graft create my-site --template docs --edit code --database none --yes"],
  },
  {
    path: ["init"],
    group: "start",
    summary: "Add Graft to a folder: graft.config.ts, content/ and llms.txt",
    description: [
      "Scaffold a Graft project in dir (default: here). The static engine is the",
      "default: no database and no environment variables.",
    ],
    args: [{ name: "dir" }],
    flags: [
      {
        name: "static",
        type: "boolean",
        summary: "Static engine: no database, no env (the default)",
      },
      {
        name: "postgres",
        type: "boolean",
        summary: "Postgres engine: operational data, typed functions, database branching",
      },
    ],
    json: true,
    database: "never",
  },
  {
    path: ["doctor"],
    group: "start",
    summary: "Check the setup and print the one thing to do next",
    description: [
      "Check this project's setup: the database, its schema, content, the index and",
      "Studio sign-in. Prints a checklist and the one thing to do next.",
    ],
    flags: [],
    json: true,
    database: "optional",
    exitCodes: [
      { code: 0, meaning: "Everything is set up" },
      { code: 1, meaning: "Something is missing; the output says what to do next" },
    ],
  },
  {
    path: ["add"],
    group: "start",
    summary: "Copy a ready-made primitive and its dependencies into graft/; alone, list them",
    description: [
      "Copy an owned primitive (and the primitives it needs) from the registry into",
      "graft/, and regenerate the graft/ barrel. graft.config.ts needs no edit.",
      "With no item, list the primitives you can add.",
    ],
    args: [{ name: "item", variadic: true }],
    flags: [DRY_RUN, { ...OVERWRITE, summary: "Replace files that differ from the registry's" }],
    json: true,
    database: "never",
    examples: ["graft add comments --dry-run"],
  },

  // Write and check content
  {
    path: ["compile"],
    group: "content",
    summary: "Check every content file and build the index, once",
    flags: [
      BRANCH,
      {
        name: "prune-unknown",
        type: "boolean",
        summary:
          "Remove index entries in collections the schema no longer has (default: refuse, which protects a shared DATABASE_URL)",
      },
    ],
    json: true,
    database: "postgres",
    examples: ["graft compile --json > changes.json"],
  },
  {
    path: ["dev"],
    group: "content",
    summary: "Watch content/ and graft.config.ts, and compile on every change",
    flags: [BRANCH],
    database: "postgres",
    longRunning: true,
  },
  {
    path: ["check"],
    group: "content",
    summary: "Check every content file: schema, slugs, MDX safety and references",
    description: [
      "Check every content file the way a compile or a publish would: the schema,",
      "slug uniqueness, MDX safety, and references to documents that don't exist.",
      "Needs no database.",
    ],
    flags: [],
    json: true,
    database: "never",
    exitCodes: [{ code: 1, meaning: "At least one file has a problem; each is listed" }],
  },
  {
    path: ["content"],
    group: "content",
    summary: "List every document; the same as graft content list",
    flags: [BRANCH],
    json: true,
    remote: true,
    database: "postgres",
  },
  {
    path: ["content", "list"],
    group: "content",
    summary: "List the documents in one collection, or in all of them",
    description: [
      "List documents with their slug, title and file. Reads the content files, or the",
      "database in a project whose content is kept there.",
    ],
    args: [{ name: "collection" }],
    flags: [BRANCH],
    json: true,
    remote: true,
    database: "postgres",
  },
  {
    path: ["content", "get"],
    group: "content",
    summary: "Print one document as an MDX file",
    description: [
      "Print one document: its frontmatter, then its body, the way the file reads.",
      "With --json, the collection, slug, file path, data and body.",
    ],
    args: [{ name: "collection/slug", required: true }],
    flags: [BRANCH],
    json: true,
    remote: true,
    database: "postgres",
    examples: ["graft content get posts/launch > launch.mdx"],
  },
  {
    path: ["content", "search"],
    group: "content",
    summary: "Search the content by words and phrases",
    description: [
      'Search with words, "quoted phrases", or and -exclusions. Searches the compiled',
      "index, so results are as fresh as the last compile.",
    ],
    args: [{ name: "query", required: true, variadic: true }],
    flags: [
      BRANCH,
      {
        name: "collection",
        type: "string",
        value: "<name>",
        example: "posts",
        summary: "Search one collection (default: all)",
      },
      {
        name: "limit",
        type: "number",
        value: "<n>",
        example: "20",
        summary: "Most matches to print, best first (default: 20)",
      },
    ],
    json: true,
    remote: true,
    database: "postgres",
    examples: ['graft content search pricing "free tier" --collection pages'],
  },
  {
    path: ["content", "write"],
    group: "content",
    summary: "Create or replace a document, checked against the schema",
    description: [
      "Write a document from an MDX file (--file), or from frontmatter as JSON (--data)",
      "and an optional body (--body-file). It is checked against the collection's schema",
      "and compiled, exactly as an agent's write_content is. A project whose content is",
      "kept in the database saves it as a draft.",
    ],
    args: [{ name: "collection/slug", required: true }],
    flags: [
      BRANCH,
      {
        name: "file",
        type: "string",
        value: "<doc.mdx|->",
        example: "launch.mdx",
        summary: "The whole document as an MDX file; - reads it from stdin",
      },
      {
        name: "data",
        type: "string",
        value: "<json>",
        example: '\'{"title":"Launch"}\'',
        summary: "The frontmatter as a JSON object; - reads it from stdin",
      },
      {
        name: "body-file",
        type: "string",
        value: "<file|->",
        example: "body.md",
        summary: "The body, with --data; - reads it from stdin",
      },
    ],
    json: true,
    remote: true,
    database: "postgres",
    examples: [
      "graft content get posts/launch > launch.mdx",
      "graft content write posts/launch --file launch.mdx",
    ],
  },
  {
    path: ["content", "set"],
    group: "content",
    summary: "Set one field on many documents",
    description: [
      "Set one frontmatter field on each document named, each written as graft content",
      "write would. One document that fails does not stop the others. --value null",
      "removes the field.",
    ],
    args: [
      { name: "collection", required: true },
      { name: "slug", required: true, variadic: true },
    ],
    flags: [
      BRANCH,
      {
        name: "field",
        type: "string",
        value: "<name>",
        example: "tags",
        summary: "The frontmatter field to set",
      },
      {
        name: "value",
        type: "string",
        value: "<json>",
        example: "'[\"launch\"]'",
        summary: "The new value as JSON; text that is not JSON is taken as a string",
      },
    ],
    json: true,
    remote: true,
    database: "postgres",
    exitCodes: [{ code: 1, meaning: "At least one document was not saved; each is listed" }],
    examples: ["graft content set posts launch roadmap --field tags --value '[\"2026\"]'"],
  },
  {
    path: ["content", "delete"],
    group: "content",
    summary: "Delete a document, once a person approves it",
    description: [
      "Delete a document. The first run files an approval and exits 3 with its id.",
      "After a person runs graft approve <id>, run it again with --approval <id>.",
    ],
    args: [{ name: "collection/slug", required: true }],
    flags: [
      BRANCH,
      {
        name: "approval",
        type: "string",
        value: "<id>",
        example: "ap_123",
        summary: "The approval a person granted for this delete",
      },
    ],
    json: true,
    remote: true,
    database: "postgres",
  },
  {
    path: ["compilations"],
    group: "content",
    summary: "List recent compiles and what each one changed",
    flags: [BRANCH],
    json: true,
    database: "always",
  },
  {
    path: ["asset", "put"],
    group: "content",
    summary: "Upload a file to the asset store and print the frontmatter that points to it",
    description: [
      "Upload a binary to the asset store (S3_* env) and print the frontmatter reference.",
      "The key defaults to assets/<file name>. A key that already holds a file is",
      "refused with ASSET_EXISTS, because the store keeps no version history.",
    ],
    args: [{ name: "file", required: true }, { name: "key" }],
    flags: [{ ...OVERWRITE, summary: "Replace the file already stored under the key" }],
    json: true,
    database: "never",
    examples: ["graft asset put ./hero.png assets/hero.png"],
  },

  {
    path: ["drafts"],
    group: "content",
    summary: "List unpublished drafts, for content kept in the database",
    flags: [BRANCH],
    json: true,
    remote: true,
    database: "always",
  },
  {
    path: ["drafts", "publish"],
    group: "content",
    summary: "Publish drafts, or ask for a review",
    description: [
      "Publish drafts by path (from graft drafts). On a site that reviews changes,",
      "this asks for a review instead. A path someone else published since is refused",
      "with CONTENT_CONFLICT; --resolve <path>=mine or =theirs settles it.",
    ],
    args: [{ name: "path", required: true, variadic: true }],
    flags: [
      BRANCH,
      {
        name: "message",
        type: "string",
        value: "<text>",
        example: "Launch post",
        summary: "The commit or review title",
      },
      {
        name: "resolve",
        type: "string",
        value: "<path>=mine|theirs",
        example: "posts/launch.mdx=mine",
        multiple: true,
        summary: "Settle a conflict on one path",
      },
    ],
    json: true,
    remote: true,
    database: "always",
  },
  {
    path: ["drafts", "discard"],
    group: "content",
    summary: "Throw away drafts, back to the published version",
    args: [{ name: "path", required: true, variadic: true }],
    flags: [BRANCH],
    json: true,
    remote: true,
    database: "always",
  },

  // Look into the project
  {
    path: ["schema"],
    group: "project",
    summary: "Print each collection's fields, and the typed functions",
    args: [{ name: "collection" }],
    flags: [BRANCH],
    json: true,
    remote: true,
    database: "postgres",
  },
  {
    path: ["fn"],
    group: "project",
    summary: "List the typed functions",
    flags: [BRANCH],
    json: true,
    remote: true,
    database: "postgres",
  },
  {
    path: ["fn", "describe"],
    group: "project",
    summary: "Print one function's input schema and access rules",
    args: [{ name: "name", required: true }],
    flags: [BRANCH],
    json: true,
    remote: true,
    database: "postgres",
  },
  {
    path: ["fn", "run"],
    group: "project",
    summary: "Run a typed function with a JSON input",
    description: [
      "Run a function through the same checks as POST /api/fn/<name>: input",
      "validation, access rules, rate limits, the audit log, and the approval a",
      "destructive function needs (exit 3, then --approval <id>).",
    ],
    args: [{ name: "name", required: true }],
    flags: [
      BRANCH,
      {
        name: "input",
        type: "string",
        value: "<json|->",
        example: '\'{"slug":"launch"}\'',
        summary: "The input as a JSON object; - reads it from stdin (default: {})",
      },
      {
        name: "approval",
        type: "string",
        value: "<id>",
        example: "ap_123",
        summary: "The approval a person granted for this call",
      },
    ],
    json: true,
    remote: true,
    database: "postgres",
  },
  {
    path: ["explain"],
    group: "project",
    summary: "Explain an error code: what it means and how to recover",
    args: [{ name: "code", required: true }],
    flags: [],
    json: true,
    database: "never",
    examples: ["graft explain SCHEMA_VALIDATION_FAILED"],
  },
  {
    path: ["mcp", "tools"],
    group: "project",
    summary: "List the MCP tools an agent sees for this project",
    flags: [BRANCH],
    json: true,
    remote: true,
    database: "postgres",
  },
  {
    path: ["mcp", "call"],
    group: "project",
    summary: "Call any MCP tool by name, as an agent would",
    args: [{ name: "tool", required: true }],
    flags: [
      BRANCH,
      {
        name: "input",
        type: "string",
        value: "<json|->",
        example: '\'{"collection":"posts"}\'',
        summary: "The tool's input as a JSON object; - reads it from stdin (default: {})",
      },
    ],
    json: true,
    remote: true,
    database: "postgres",
    examples: ['graft mcp call list_content --input \'{"collection":"posts"}\''],
  },

  // Run Graft
  {
    path: ["mcp"],
    group: "run",
    summary: "Serve the project to an agent on this computer over stdio (MCP)",
    description: [
      "Serve the project MCP over stdio: content and function tools, for .mcp.json",
      "and other local agents. On the Postgres engine it needs DATABASE_URL.",
    ],
    flags: [
      BRANCH,
      {
        name: "elicit-approvals",
        type: "boolean",
        summary:
          "Ask this terminal's operator to decide a destructive call, instead of failing with an id for graft approve",
      },
    ],
    database: "postgres",
    updateCheck: false,
  },
  {
    path: ["serve"],
    group: "run",
    summary: "Run Graft over HTTP: functions, MCP, the Content API and /healthz",
    description: [
      "Run the headless Graft runtime over HTTP: POST /api/fn/<name>, POST /api/mcp,",
      "GET /api/content/v1/*, GET /healthz. This is what a self-hosted container runs.",
    ],
    flags: [
      BRANCH,
      PORT("3903", "PORT"),
      HOST,
      {
        name: "studio",
        type: "boolean",
        env: "GRAFT_STUDIO",
        summary: "Serve Studio at /studio too",
      },
    ],
    database: "always",
    longRunning: true,
  },
  {
    path: ["studio"],
    group: "run",
    summary: "Open Studio, the editor, on this computer",
    description: [
      "Run Studio: edit content, approve or deny actions, and read the OpenAPI document.",
      "Without a database, saves go to your files.",
    ],
    flags: [BRANCH, PORT("4983", "GRAFT_STUDIO_PORT"), HOST],
    database: "optional",
    longRunning: true,
  },
  {
    path: ["studio", "invite"],
    group: "run",
    summary: "Print a sign-in link for a hosted Studio",
    description: [
      "Print a sign-in link for someone without a GitHub account. It is signed with",
      "GRAFT_STUDIO_SECRET and expires after --days. To give someone an account",
      "instead, invite them from Studio's Settings.",
    ],
    args: [{ name: "email", required: true }],
    flags: [
      {
        name: "role",
        type: "string",
        value: "<role>",
        example: "editor",
        summary: "viewer, contributor, editor (default) or admin",
      },
      {
        name: "name",
        type: "string",
        value: "<name>",
        example: "Ada",
        summary: "The name commits are attributed to",
      },
      {
        name: "days",
        type: "number",
        value: "<n>",
        example: "7",
        summary: "How long the link works, 1 to 30 (default: 7)",
      },
      {
        name: "url",
        type: "string",
        value: "<url>",
        example: "https://example.com",
        env: "GRAFT_STUDIO_URL",
        summary: "Where Studio is served",
      },
    ],
    json: true,
    database: "never",
  },
  {
    path: ["studio", "setup-code"],
    group: "run",
    summary: "Print the code a hosted Studio asks for on its first visit",
    description: [
      "Print the code a hosted Studio asks for before it creates the owner account.",
      "It comes from GRAFT_STUDIO_SECRET, so run it with the site's settings.",
    ],
    flags: [],
    database: "never",
  },

  // Keep content in the database
  {
    path: ["content", "import"],
    group: "sync",
    summary: "Load the content files into the database, for a database-sourced project",
    description: [
      'For a project with content = { source: "database" }: load the files under the',
      "content directory into the database. Every file is checked first. Only documents",
      "with nothing published come in: a published document is never overwritten, and",
      "a missing file deletes nothing. To change published content, use Studio or",
      "graft push.",
    ],
    flags: [BRANCH, DRY_RUN],
    json: true,
    database: "always",
  },
  {
    path: ["pull"],
    group: "sync",
    summary: "Write what is published into your files",
    description: [
      'For a project with content = { source: "database" }: write what is published',
      "into the files under the content directory. A file you changed since your last",
      "pull is kept for graft push. One changed both here and in the database is left",
      "as it is and listed, unless --force takes the published version.",
    ],
    args: [{ name: "doc", variadic: true }],
    flags: [BRANCH, ONLY, FORCE_SYNC],
    json: true,
    database: "always",
    examples: ["graft pull posts/launch"],
  },
  {
    path: ["push"],
    group: "sync",
    summary: "Publish the files you changed since your last pull",
    description: [
      "Publish the files you changed since your last graft pull, checked as graft",
      "compile checks them. Refused, with nothing written, if someone published one",
      "of those documents since your pull: pull first. --force publishes over it.",
    ],
    args: [{ name: "doc", variadic: true }],
    flags: [BRANCH, ONLY, DRY_RUN, FORCE_SYNC],
    json: true,
    database: "always",
  },
  {
    path: ["mirror"],
    group: "sync",
    summary: "Commit what was published since the last run to GitHub",
    description: [
      "Commit everything published since the last run to the GitHub repository in",
      "GRAFT_GITHUB_REPO, as one commit. Run it on a schedule, or let graft serve do",
      "it when graft.config.ts sets content.mirror.",
    ],
    flags: [BRANCH],
    json: true,
    database: "always",
  },

  // Manage the database
  {
    path: ["db", "migrate"],
    group: "database",
    summary: "Create or update the tables Graft needs; safe to run again",
    description: [
      "Apply the Postgres schema migrations that ship with @usegraft/db. This is the",
      "first command a Postgres-engine project runs.",
    ],
    flags: [{ ...DRY_RUN, summary: "List pending schema migrations without applying them" }],
    json: true,
    database: "always",
  },
  {
    path: ["db", "claim"],
    group: "database",
    summary: "Keep the free database graft create made",
    description: [
      "Keep the free database `graft create --database new` made. Prints the link to",
      "claim it (a free Neon account), waits until you have, then asks for the new",
      "connection string and saves it to .env. Claiming changes the password, so",
      "the old DATABASE_URL stops working.",
    ],
    flags: [
      {
        name: "url",
        type: "string",
        value: "<postgres-url>",
        example: "postgres://user:password@host/db",
        summary: "The claimed database's connection string, instead of the question",
      },
    ],
    database: "never",
    interactive: true,
  },
  {
    path: ["migrate"],
    group: "database",
    summary: "Run your own content and data migrations",
    description: [
      "Show pending content and data migrations. --apply runs them and records each",
      "in the ledger. A concurrent --apply on the same branch waits for this one and",
      "then skips what it applied.",
    ],
    flags: [BRANCH, APPLY],
    json: true,
    database: "always",
  },
  {
    path: ["harden"],
    group: "database",
    summary: "Give a database role the limited rights a deployed app needs",
    description: [
      "Grant an existing Postgres role the runtime privilege set: it can request and",
      "consume approvals but never decide them.",
    ],
    args: [{ name: "role", required: true }],
    flags: [],
    json: true,
    database: "always",
  },

  // Approve actions
  {
    path: ["approvals"],
    group: "approvals",
    summary: "List actions waiting for a person to approve them",
    flags: [],
    json: true,
    remote: true,
    database: "always",
  },
  {
    path: ["approve"],
    group: "approvals",
    summary: "Approve an action; the caller then repeats its call with the id",
    args: [{ name: "approval-id", required: true }],
    flags: [],
    json: true,
    database: "always",
  },
  {
    path: ["deny"],
    group: "approvals",
    summary: "Deny an action",
    args: [{ name: "approval-id", required: true }],
    flags: [],
    json: true,
    database: "always",
  },

  // Work with preview branches
  {
    path: ["branch"],
    group: "branches",
    summary: "List branches",
    flags: [],
    json: true,
    database: "always",
  },
  {
    path: ["branch", "create"],
    group: "branches",
    summary: "Create a preview branch",
    args: [{ name: "name", required: true }],
    flags: [
      {
        name: "from",
        type: "string",
        value: "<parent>",
        example: "main",
        summary: "Branch to fork from (default: main)",
      },
      {
        name: "backend",
        type: "string",
        value: "overlay|neon",
        example: "overlay",
        summary: "overlay (default) shares the parent's rows; neon forks a physical Neon branch",
      },
    ],
    json: true,
    database: "always",
  },
  {
    path: ["branch", "drop"],
    group: "branches",
    summary: "Delete a branch: purge an overlay's rows, or delete a Neon fork",
    args: [{ name: "name", required: true }],
    flags: [],
    json: true,
    database: "always",
  },
  {
    path: ["merge"],
    group: "branches",
    summary: "Merge a branch: replay its migrations, move its data, recompile",
    args: [{ name: "branch", required: true }],
    flags: [
      {
        name: "into",
        type: "string",
        value: "<target>",
        example: "main",
        summary: "Branch to merge into (default: main)",
      },
      APPLY,
    ],
    json: true,
    database: "always",
  },

  // Keep CI cheap
  {
    path: ["ci", "changes"],
    group: "ci",
    summary: "Print content-only=true when only content changed",
    description: [
      "Print content-only=true when every changed file is content, and write it to",
      "$GITHUB_OUTPUT for later steps to read.",
    ],
    flags: [BASE],
    json: true,
    database: "never",
  },
  {
    path: ["ci", "skip-build"],
    group: "ci",
    summary: "Exit 0 when a deploy can be skipped",
    description: [
      "Exit 0 when the deploy can be skipped: only content changed, and the site",
      "already serves it from the database. Never skips on the previous commit alone.",
    ],
    flags: [BASE],
    json: true,
    database: "never",
    exitCodes: [
      { code: 0, meaning: "Skip the build" },
      { code: 1, meaning: "Build" },
    ],
  },
  {
    path: ["ci", "init"],
    group: "ci",
    summary: "Write a workflow that runs graft check on content changes",
    flags: [{ ...OVERWRITE, summary: "Replace the workflow file if it exists" }],
    database: "never",
  },

  // Work with a hosted site
  {
    path: ["login"],
    group: "remote",
    summary: "Save a token for a hosted site, for --remote and graft api",
    description: [
      "Check a token against a hosted Graft site and save it, so commands that take",
      "--remote and graft api can use it. Make the token in Studio under Developer,",
      "Agents. It is read from stdin, or asked for without echoing it, never taken as",
      "an argument. No token can approve or deny an action.",
    ],
    args: [{ name: "url", required: true }],
    flags: [
      {
        name: "with-token",
        type: "boolean",
        summary: "Read the token from stdin (the default when stdin is not a terminal)",
      },
    ],
    json: true,
    database: "never",
    interactive: true,
    examples: ['printf %s "$TOKEN" | graft login https://cms.example.com --with-token'],
  },
  {
    path: ["logout"],
    group: "remote",
    summary: "Forget a site's token on this computer",
    description: [
      "Remove a site's saved token (default: the default site). The token itself keeps",
      "working until someone revokes it in Studio under Developer, Agents.",
    ],
    args: [{ name: "url" }],
    flags: [],
    json: true,
    database: "never",
  },
  {
    path: ["auth", "status"],
    group: "remote",
    summary: "Check each saved token against its site",
    description: [
      "List every site the CLI can reach, from graft login and GRAFT_URL, and check each",
      "token against the site. Tokens are shown by their first characters only.",
    ],
    flags: [],
    json: true,
    database: "never",
    exitCodes: [
      { code: 0, meaning: "At least one token works, or --json was given" },
      { code: 4, meaning: "No token works, or there is none" },
    ],
  },
  {
    path: ["auth", "token"],
    group: "remote",
    summary: "Print a site's saved token, for piping into another tool",
    args: [{ name: "url" }],
    flags: [],
    database: "never",
  },
  {
    path: ["api"],
    group: "remote",
    summary: "Call any Studio API route on a hosted site with the saved token",
    description: [
      "Call a route on the site in GRAFT_URL, or the one graft login saved. A path is",
      "under /api/studio/v1 unless it starts with /api/fn or /api/content/v1. Fields",
      "make the request a POST with a JSON body; with -X GET or --paginate they become",
      "the query string. Prints the answer; with no path, lists the routes.",
    ],
    args: [{ name: "path" }],
    flags: [
      {
        name: "method",
        short: "X",
        type: "string",
        value: "<method>",
        example: "PUT",
        summary:
          "The HTTP method (default: GET, or POST when there are fields or --input, unless --paginate)",
      },
      {
        name: "raw-field",
        short: "f",
        type: "string",
        value: "<key=value>",
        example: "collection=posts",
        multiple: true,
        summary: "A field whose value is sent as a string",
      },
      {
        name: "field",
        short: "F",
        type: "string",
        value: "<key=value>",
        example: "limit=10",
        multiple: true,
        summary:
          "A field whose value is typed: true, false, null and numbers as JSON, @file and @- as the file's text",
      },
      {
        name: "header",
        short: "H",
        type: "string",
        value: "<name: value>",
        example: "'accept: application/json'",
        multiple: true,
        summary: "An extra request header",
      },
      {
        name: "input",
        type: "string",
        value: "<file|->",
        example: "body.json",
        summary: "Send this file as the body; - reads stdin",
      },
      {
        name: "include",
        short: "i",
        type: "boolean",
        summary: "Print the status line and headers before the body",
      },
      {
        name: "paginate",
        type: "boolean",
        summary: "GET every page, following nextCursor, and print each one",
      },
      {
        name: "slurp",
        type: "boolean",
        summary: "With --paginate, print every page as one JSON array once the last arrives",
      },
      {
        name: "yes",
        short: "y",
        type: "boolean",
        summary: "Send -X DELETE without asking first",
      },
    ],
    database: "never",
    // A DELETE asks before it is sent, on a terminal; --no-input refuses instead.
    interactive: true,
    examples: [
      "graft api workspace",
      "graft api entries -X GET -f collection=posts -F limit=20",
      "graft api entries -f collection=posts --paginate",
      "graft api entries --paginate --slurp",
      "graft api -X PUT entry --input entry.json",
    ],
  },

  // Learn the CLI
  {
    path: ["help"],
    group: "help",
    summary: "Show help for a command or a topic",
    args: [{ name: "command-or-topic", variadic: true }],
    flags: [],
    database: "never",
    updateCheck: false,
    examples: ["graft help branch create", "graft help exit-codes"],
  },
  {
    path: ["commands"],
    group: "help",
    summary: "List every command; --json describes each one and its flags",
    flags: [],
    json: true,
    database: "never",
    updateCheck: false,
  },
];

/** Flags every command takes. */
export const HELP_FLAG: FlagSpec = {
  name: "help",
  short: "h",
  type: "boolean",
  summary: "Show this command's help",
};
export const JSON_FLAG: FlagSpec = {
  name: "json",
  type: "boolean",
  summary: "Print one JSON object on stdout; messages go to stderr",
};
export const REMOTE_FLAG: FlagSpec = {
  name: "remote",
  type: "boolean",
  summary: "Work on the hosted site in GRAFT_URL, or the one graft login saved",
};
export const LOCAL_FLAG: FlagSpec = {
  name: "local",
  type: "boolean",
  summary: "Work on the project in this folder, even when GRAFT_URL is set",
};
export const NO_INPUT_FLAG: FlagSpec = {
  name: "no-input",
  type: "boolean",
  env: "GRAFT_PROMPT_DISABLED",
  summary: "Never stop to ask a question",
};

/** The command's id, which handlers.ts is keyed by: "branch create". */
export function commandId(spec: CommandSpec): string {
  return spec.path.join(" ");
}

/** Every flag a command accepts: its own, then the ones its kind of command takes. */
export function flagsOf(spec: CommandSpec): FlagSpec[] {
  return [
    ...spec.flags,
    ...(spec.json ? [JSON_FLAG] : []),
    ...(spec.interactive ? [NO_INPUT_FLAG] : []),
    ...(spec.remote ? [REMOTE_FLAG, LOCAL_FLAG] : []),
    HELP_FLAG,
  ];
}

/** `graft branch create <name> [--from <parent>] [--backend overlay|neon] [--json]` */
export function usageOf(spec: CommandSpec): string {
  const words = ["graft", ...spec.path];
  for (const arg of spec.args ?? []) {
    const name = arg.variadic ? `${arg.name}...` : arg.name;
    words.push(arg.required ? `<${name}>` : `[${name}]`);
  }
  for (const flag of flagsOf(spec)) {
    if (flag === HELP_FLAG) continue;
    const value = flag.type === "boolean" ? "" : ` ${flag.value ?? "<value>"}`;
    words.push(`[--${flag.name}${value}]${flag.multiple ? "..." : ""}`);
  }
  return words.join(" ");
}

/** Commands whose path starts with these words, in table order. */
export function commandsUnder(words: readonly string[]): CommandSpec[] {
  return COMMANDS.filter((spec) => words.every((word, i) => spec.path[i] === word));
}
