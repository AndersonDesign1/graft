/**
 * Where a project's setup stands, as a checklist with one next step: what
 * `graft doctor` prints and MCP `setup_status` returns, so a person and their
 * coding agent see the same answer.
 *
 * Every check says what it found in plain words and, when something is
 * missing, the one command that fixes it. Checks that need something earlier
 * in the list (a database, before its version) are skipped rather than failed,
 * so the first failure is the thing to do next.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { countAccounts, readJournal, sql, type Database } from "@usegraft/db";

export type CheckState = "pass" | "warn" | "fail";

export interface SetupCheck {
  id: string;
  state: CheckState;
  /** What was checked, as a heading. */
  title: string;
  /** What was found, in a sentence. */
  detail: string;
  /** The command or step that fixes it, when it isn't passing. */
  fix?: string;
}

export interface SetupStatus {
  /** True when nothing fails. Warnings are worth reading but block nothing. */
  ready: boolean;
  checks: SetupCheck[];
  /** The first failing check's fix, else the first warning's, else null. */
  next: string | null;
}

/** A database Graft created for someone with no account, until they claim it. */
export interface ClaimableDatabase {
  provider: "neon";
  id: string;
  claimUrl: string;
  expiresAt: string;
  claimed?: boolean;
}

/** Where `graft create` records a claimable database, next to the compiled index. */
export const CLAIMABLE_DATABASE_FILE = join(".graft", "database.json");

export function readClaimableDatabase(projectDir: string): ClaimableDatabase | null {
  try {
    const parsed = JSON.parse(
      readFileSync(join(projectDir, CLAIMABLE_DATABASE_FILE), "utf8"),
    ) as Partial<ClaimableDatabase>;
    return parsed.provider === "neon" && parsed.id && parsed.claimUrl && parsed.expiresAt
      ? (parsed as ClaimableDatabase)
      : null;
  } catch {
    return null;
  }
}

export interface SetupStatusInput {
  projectDir: string;
  contentDir: string;
  index: "static" | "postgres";
  source: "git" | "database";
  /** For a static index: where the compiled artifact lives. */
  staticIndexPath?: string;
  /** For a Postgres index: an open handle, or undefined when there is no DATABASE_URL. */
  db?: Database;
  /** The URL behind `db`, when known: it makes the connection advice specific. */
  databaseUrl?: string;
  env?: Record<string, string | undefined>;
  now?: Date;
}

/**
 * Checks that only matter once the site is online: a missing Studio secret.
 * They show as warnings, and never become `next` while working locally. Once
 * the secret is set, the owner account it's for is the next step.
 */
const FOR_LATER = new Set(["studio-secret"]);

const MIN_POSTGRES = 130000;
const DAY = 24 * 60 * 60 * 1000;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function isLocalHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

function hasContentFiles(dir: string): boolean {
  if (!existsSync(dir)) return false;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && hasContentFiles(join(dir, entry.name))) return true;
    if (entry.isFile() && /\.mdx?$/.test(entry.name)) return true;
  }
  return false;
}

export async function setupStatus(input: SetupStatusInput): Promise<SetupStatus> {
  const env = input.env ?? process.env;
  const now = input.now ?? new Date();
  const checks: SetupCheck[] = [];
  const add = (check: SetupCheck): void => {
    checks.push(check);
  };

  // ---- the database ---------------------------------------------------------
  let connected = false;
  if (input.index === "static") {
    add({
      id: "database",
      state: "pass",
      title: "Database",
      detail:
        "None needed: this project compiles its content to a file. Studio and the database content source need Postgres.",
    });
  } else if (!input.db) {
    add({
      id: "database",
      state: "fail",
      title: "Database",
      detail: "DATABASE_URL is not set.",
      fix: "Put DATABASE_URL=postgres://… in .env. Any Postgres 13 or newer works. `npm create graft` can make a free one for you.",
    });
  } else {
    const url = input.databaseUrl ?? "";
    try {
      const rows = await input.db.execute<{ server_version_num: string }>(
        sql`show server_version_num`,
      );
      const version = Number(rows[0]?.server_version_num ?? 0);
      connected = true;
      add(
        version >= MIN_POSTGRES
          ? {
              id: "database",
              state: "pass",
              title: "Database",
              detail: `Connected to Postgres ${Math.floor(version / 10000)}.`,
            }
          : {
              id: "database",
              state: "fail",
              title: "Database",
              detail: `Connected, but it runs Postgres ${Math.floor(version / 10000)}. Graft needs 13 or newer.`,
              fix: "Upgrade the database, or point DATABASE_URL at a newer one.",
            },
      );
    } catch (error) {
      const host = hostOf(url);
      const reason = error instanceof Error ? error.message : String(error);
      const ssl =
        !isLocalHost(host) && !/sslmode=/.test(url) && /ssl|tls|encrypt|pg_hba/i.test(reason);
      add({
        id: "database",
        state: "fail",
        title: "Database",
        detail: `Couldn't connect to ${host || "the database"}: ${reason}`,
        fix: ssl
          ? "This host wants an encrypted connection: add ?sslmode=require to the end of DATABASE_URL."
          : "Check DATABASE_URL: the host, the password, and that the database accepts connections from here.",
      });
    }
    if (/-pooler\.|:6543\b/.test(url)) {
      add({
        id: "database-pooled",
        state: "warn",
        title: "Connection pooler",
        detail:
          "DATABASE_URL goes through a connection pooler. Reading and publishing work, but migrations can fail through one.",
        fix: "Run `graft db migrate` with the direct URL (for Neon, drop -pooler from the host).",
      });
    }
  }

  // ---- a database Graft created, until it is claimed ------------------------
  const claimable = readClaimableDatabase(input.projectDir);
  if (claimable && !claimable.claimed) {
    const left = new Date(claimable.expiresAt).getTime() - now.getTime();
    const hours = Math.max(0, Math.floor(left / (60 * 60 * 1000)));
    add(
      left <= 0
        ? {
            id: "claim",
            state: "fail",
            title: "Free database",
            detail:
              "The free database Graft created expired before it was claimed, with everything in it.",
            fix: "Point DATABASE_URL at another Postgres, then `graft db migrate` and `graft content import`.",
          }
        : {
            id: "claim",
            state: left < DAY ? "fail" : "warn",
            title: "Free database",
            detail: `Not claimed yet. It is deleted in ${hours} hour${hours === 1 ? "" : "s"} unless someone claims it.`,
            fix: "Run `graft db claim` and sign in to keep it, for free.",
          },
    );
  }

  // ---- the schema -----------------------------------------------------------
  if (input.index === "postgres" && connected && input.db) {
    let applied = new Set<number>();
    try {
      const rows = await input.db.execute<{ created_at: string | number | null }>(
        sql`select created_at from drizzle.__drizzle_migrations`,
      );
      applied = new Set(rows.map((row) => Number(row.created_at)));
    } catch {
      // No ledger yet: nothing applied.
    }
    const pending = readJournal().filter((entry) => !applied.has(entry.when));
    add(
      pending.length === 0
        ? { id: "schema", state: "pass", title: "Schema", detail: "Up to date." }
        : {
            id: "schema",
            state: "fail",
            title: "Schema",
            detail: `${pending.length} migration${pending.length === 1 ? "" : "s"} not applied yet.`,
            fix: "Run `graft db migrate`.",
          },
    );
  }

  // ---- content --------------------------------------------------------------
  const schemaReady = !checks.some((check) => check.id === "schema" && check.state === "fail");
  if (input.source === "database") {
    if (connected && input.db && schemaReady) {
      const rows = await input.db.execute<{ n: number }>(
        sql`select count(*)::int as n from content_heads where published_id is not null`,
      );
      const published = Number(rows[0]?.n ?? 0);
      add(
        published > 0
          ? {
              id: "content",
              state: "pass",
              title: "Content",
              detail: `${published} published document${published === 1 ? "" : "s"} in the database.`,
            }
          : {
              id: "content",
              state: "warn",
              title: "Content",
              detail: "Nothing is published in the database yet.",
              fix: hasContentFiles(input.contentDir)
                ? "Run `graft content import` to bring your files in."
                : "Open Studio (`graft studio`) and create your first page.",
            },
      );
    }
  } else {
    add(
      hasContentFiles(input.contentDir)
        ? { id: "content", state: "pass", title: "Content", detail: "Content files found." }
        : {
            id: "content",
            state: "warn",
            title: "Content",
            detail: "No content files yet.",
            fix: "Add one at content/<collection>/<slug>.mdx, or open Studio with `graft studio`.",
          },
    );
  }

  // ---- the compiled index ---------------------------------------------------
  if (input.index === "static") {
    const path = input.staticIndexPath ?? join(input.projectDir, ".graft", "index.db");
    add(
      existsSync(path)
        ? { id: "index", state: "pass", title: "Index", detail: "Compiled." }
        : {
            id: "index",
            state: "fail",
            title: "Index",
            detail: "Not compiled yet, so the site has nothing to read.",
            fix: "Run `graft compile`.",
          },
    );
  } else if (connected && input.db && schemaReady) {
    const rows = await input.db.execute<{ n: number }>(
      sql`select count(*)::int as n from compilations`,
    );
    add(
      Number(rows[0]?.n ?? 0) > 0
        ? { id: "index", state: "pass", title: "Index", detail: "Compiled." }
        : {
            id: "index",
            state: "fail",
            title: "Index",
            detail: "Not compiled yet, so the site has nothing to read.",
            fix: "Run `graft compile`.",
          },
    );
  }

  // ---- Studio sign-in, for putting it online --------------------------------
  if (input.index === "postgres") {
    const secret = env.GRAFT_STUDIO_SECRET;
    if (!secret || secret.length < 32) {
      add({
        id: "studio-secret",
        state: "warn",
        title: "Studio sign-in",
        detail:
          "GRAFT_STUDIO_SECRET is not set. Studio works on this computer, but can't let people sign in online.",
        fix: "Add GRAFT_STUDIO_SECRET to .env: 32 or more random characters, such as the output of `openssl rand -base64 48`.",
      });
    } else if (connected && input.db && schemaReady) {
      const people = await countAccounts(input.db);
      add(
        people > 0
          ? {
              id: "studio",
              state: "pass",
              title: "Studio sign-in",
              detail: `${people} ${people === 1 ? "person has" : "people have"} a Studio account.`,
            }
          : {
              id: "studio",
              state: "warn",
              title: "Studio sign-in",
              detail:
                "Nobody has a Studio account yet. On this computer `graft studio` needs none; online, people sign in.",
              fix: "Once the site is online, open /studio there: the first visit creates the owner account, with the code `graft studio setup-code` prints.",
            },
      );
    }
  }

  return {
    ready: !checks.some((check) => check.state === "fail"),
    checks,
    next: nextStep(checks),
  };
}

/**
 * The one thing to do now: the first failure's fix, else the first warning's.
 * A check about putting the site online is not the next thing to do here.
 */
export function nextStep(checks: readonly SetupCheck[]): string | null {
  const failing = checks.find((check) => check.state === "fail");
  const warning = checks.find((check) => check.state === "warn" && !FOR_LATER.has(check.id));
  return failing?.fix ?? warning?.fix ?? null;
}

/** The checklist as lines for a terminal. */
export function formatSetupStatus(status: SetupStatus): string {
  const mark: Record<CheckState, string> = { pass: "✓", warn: "!", fail: "✗" };
  const lines = status.checks.map(
    (check) => `${mark[check.state]} ${check.title}: ${check.detail}`,
  );
  lines.push("");
  const later = status.checks.some((check) => check.state === "warn");
  lines.push(
    status.next
      ? `Next: ${status.next}`
      : later
        ? "Ready to work on this computer: run `graft dev` for the site, or `graft studio` to edit. The ! lines matter when you put the site online."
        : "Everything is set up. Run `graft dev` to work on the site, or `graft studio` to edit.",
  );
  return lines.join("\n");
}
