/**
 * graft db claim — keep the free database `graft create` made.
 *
 * Unclaimed, it is deleted after 72 hours. Claiming moves it into a free Neon
 * account and, as part of that, revokes the old password: the DATABASE_URL in
 * .env stops working. So this prints the claim link, waits for the claim, then
 * takes the new connection string, checks it reaches the same data, and saves
 * it.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { CLAIMABLE_DATABASE_FILE, readClaimableDatabase } from "@usegraft/compiler";
import { GraftError } from "@usegraft/contracts";
import { findConfig } from "../config";
import { claimState, directUrlOf } from "../create/neon";

export interface DbClaimOptions {
  cwd: string;
  /** The claimed database's connection string, instead of asking for it. */
  url?: string;
  fetch?: typeof fetch;
  /** How long to wait for the claim, in ms. Default 15 minutes. */
  waitMs?: number;
  pollMs?: number;
  log?: (line: string) => void;
  askUrl?: () => Promise<string>;
}

export type DbClaimResult = "saved" | "waiting" | "claimed-elsewhere";

/** Set one variable in a .env file, keeping every other line as it was. */
export function setEnvVar(path: string, name: string, value: string): void {
  const lines = existsSync(path) ? readFileSync(path, "utf8").split("\n") : [];
  const at = lines.findIndex((line) => line.startsWith(`${name}=`));
  if (at === -1) {
    if (lines.length > 0 && lines[lines.length - 1] === "")
      lines.splice(lines.length - 1, 0, `${name}=${value}`);
    else lines.push(`${name}=${value}`, "");
  } else lines[at] = `${name}=${value}`;
  writeFileSync(path, lines.join("\n"), { mode: 0o600 });
}

async function askOnTerminal(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (
      await rl.question(
        "Paste the connection string from your Neon project (Dashboard, then Connect):\n> ",
      )
    ).trim();
  } finally {
    rl.close();
  }
}

export async function dbClaimCommand(options: DbClaimOptions): Promise<DbClaimResult> {
  const log = options.log ?? ((line: string) => console.log(line));
  const projectDir = dirname(findConfig(options.cwd));
  const claimable = readClaimableDatabase(projectDir);
  if (!claimable) {
    throw new GraftError({
      code: "CONFIG_INVALID",
      message: "There's no free database to claim in this project.",
      fix: "`graft db claim` is for the database `graft create --database new` made. Any other Postgres is already yours: set DATABASE_URL in .env.",
      details: { file: CLAIMABLE_DATABASE_FILE },
    });
  }

  const save = async (raw: string): Promise<DbClaimResult> => {
    const url = directUrlOf(raw.trim());
    if (!/^postgres(ql)?:\/\//.test(url)) {
      throw new GraftError({
        code: "INPUT_VALIDATION_FAILED",
        message: "That isn't a Postgres connection string.",
        fix: "Copy the string that starts with postgresql:// from your Neon project's Connect dialog.",
      });
    }
    // The schema check doubles as a check that this is the same database:
    // a different, empty one would need every migration.
    const { createDb, migrationStatus } = await import("@usegraft/db");
    const handle = createDb(url);
    try {
      const { applied } = await migrationStatus(handle.sql);
      if (applied.length === 0) {
        throw new GraftError({
          code: "CONFIG_INVALID",
          message: "That database is empty, so it isn't the one Graft made for this site.",
          fix: "Copy the connection string of the project you just claimed (it has your content), then run `graft db claim --url <it>`.",
        });
      }
    } catch (error) {
      if (error instanceof GraftError) throw error;
      throw new GraftError({
        code: "CONFIG_INVALID",
        message: `Couldn't connect with that string: ${error instanceof Error ? error.message : String(error)}`,
        fix: "Copy it again from your Neon project's Connect dialog, including the password.",
      });
    } finally {
      await handle.close();
    }
    setEnvVar(join(projectDir, ".env"), "DATABASE_URL", url);
    writeFileSync(
      join(projectDir, CLAIMABLE_DATABASE_FILE),
      `${JSON.stringify({ ...claimable, claimed: true }, null, 2)}\n`,
    );
    log("✓ Saved the new DATABASE_URL to .env. The database is yours now, with no expiry.");
    log("  If the site is online, update DATABASE_URL there too.");
    return "saved";
  };

  if (options.url) return save(options.url);
  if (claimable.claimed) {
    log(
      "This database is already claimed. To change its connection string, run `graft db claim --url <url>`.",
    );
    return "claimed-elsewhere";
  }

  let state = await claimState(claimable.id, options.fetch);
  if (state === "gone") {
    throw new GraftError({
      code: "CONFIG_INVALID",
      message: "The free database expired before it was claimed, with everything in it.",
      fix: "Point DATABASE_URL at another Postgres (or run `npm create graft` again), then `graft db migrate` and `graft content import`.",
    });
  }
  if (state === "unclaimed") {
    log("Open this link and sign in (or sign up, for free) to keep the database:");
    log("");
    log(`  ${claimable.claimUrl}`);
    log("");
    log("Waiting for the claim… (Ctrl+C to stop; run `graft db claim` again later)");
    const deadline = Date.now() + (options.waitMs ?? 15 * 60_000);
    while (state === "unclaimed" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, options.pollMs ?? 5000));
      state = await claimState(claimable.id, options.fetch);
    }
    if (state === "unclaimed") {
      log("Still not claimed. Run `graft db claim` again once you have.");
      return "waiting";
    }
  }

  log("✓ Claimed. Claiming changed its password, so the old DATABASE_URL no longer works.");
  if (options.askUrl || process.stdin.isTTY) {
    return save(await (options.askUrl ?? askOnTerminal)());
  }
  log("Copy the connection string from your Neon project (Dashboard, then Connect) and run:");
  log("  graft db claim --url <connection string>");
  return "claimed-elsewhere";
}
