/**
 * What each command does, keyed by its id in registry.ts.
 *
 * A handler prints for people and returns its answer as `data`. Under --json
 * the dispatcher points stdout at stderr while the handler runs and then
 * prints `data` alone, so a handler never has to think about the two modes;
 * it may skip text nobody will read when `ctx.json` is set.
 *
 * Every command module is imported inside its handler, so `graft --help`
 * and a usage error never load the database driver or the compiler.
 */
import type { Flags } from "./args";
import type { SyncCommandOptions } from "./commands/sync";
import type { ToolTarget } from "./tool-runner";
import type { ToolClient } from "@usegraft/mcp";
import { UsageError } from "./args";
import { commandHelp, commandList, describeCli, rootHelp, topicHelp } from "./help";
import { VERSION } from "./version";

export interface CommandContext {
  cwd: string;
  args: string[];
  flags: Flags;
  /** --json: return the answer as data; text goes to stderr. */
  json: boolean;
  /** --no-input or GRAFT_PROMPT_DISABLED: never ask a question. */
  noInput: boolean;
}

export interface CommandOutcome {
  /** The answer, printed as JSON under --json. Always an object. */
  data?: object;
  /** Overrides 0, for commands whose answer is a yes or no. */
  exitCode?: number;
}

export type Handler = (ctx: CommandContext) => Promise<CommandOutcome | void>;

const branchOf = (ctx: CommandContext): string | undefined => ctx.flags.string("branch");

const handlers = {
  /* ---- set up a project ------------------------------------------------- */

  async create(ctx) {
    const { createCommand } = await import("./commands/create");
    const { flags } = ctx;
    const template = flags.string("template");
    const edit = flags.string("edit");
    const database = flags.string("database");
    const framework = flags.string("framework");
    await createCommand({
      dir: ctx.args[0] ?? ".",
      ...(template ? { template } : {}),
      ...(edit ? { edit } : {}),
      ...(database ? { database } : {}),
      ...(framework ? { framework } : {}),
      yes: flags.bool("yes"),
      input: !ctx.noInput,
      install: !flags.bool("no-install"),
    });
  },

  async init(ctx) {
    const { initCommand } = await import("./commands/init");
    const { flags } = ctx;
    const driver = flags.bool("postgres")
      ? "postgres"
      : flags.bool("static")
        ? "static"
        : undefined;
    const result = initCommand({ targetDir: ctx.args[0] ?? ctx.cwd, driver });
    if (ctx.json) return { data: result };
    console.log(
      `Initialized a Graft project in ${result.projectDir} (${result.driver} index, ${result.created.length} file(s)):`,
    );
    for (const file of result.created) console.log(`  created ${file}`);
    console.log(
      result.driver === "static"
        ? [
            "",
            "Next steps — no database, no environment variables:",
            "  1. Install the runtime: add @usegraft/core and zod (plus @usegraft/cli as a dev dep)",
            "  2. Run `graft compile` once, or keep `graft dev` running while you edit",
            "",
            "The index compiles to .graft/index.db (git-ignored — it is derived from your",
            "files). Run `graft compile` before your app builds so it ships with the deploy.",
            "Need operational data, typed functions, or DB branching? Switch `index` to",
            '"postgres" in graft.config.ts and set DATABASE_URL.',
          ].join("\n")
        : [
            "",
            "Next steps:",
            "  1. Install the runtime: add @usegraft/core and zod (plus @usegraft/cli as a dev dep)",
            "  2. Put DATABASE_URL=postgres://… in .env",
            "  3. Run `graft compile` once, or keep `graft dev` running while you edit",
          ].join("\n"),
    );
    return { data: result };
  },

  async doctor(ctx) {
    const { doctorCommand } = await import("./commands/doctor");
    const status = await doctorCommand({ cwd: ctx.cwd });
    if (!ctx.json) {
      const { formatSetupStatus } = await import("@usegraft/compiler");
      console.log(formatSetupStatus(status));
    }
    return { data: status, exitCode: status.ready ? 0 : 1 };
  },

  async add(ctx) {
    if (ctx.args.length === 0) {
      const { listItems } = await import("@usegraft/registry");
      const items = listItems().map(({ name, type, description }) => ({ name, type, description }));
      if (!ctx.json) {
        for (const item of items)
          console.log(`${item.name.padEnd(20)} ${item.type.padEnd(10)} ${item.description}`);
        console.log("\nAdd one with `graft add <item>`; --dry-run shows what it writes.");
      }
      return { data: { items } };
    }
    const { addCommand } = await import("./commands/add");
    const result = await addCommand({
      cwd: ctx.cwd,
      names: ctx.args,
      dryRun: ctx.flags.bool("dry-run"),
      overwrite: ctx.flags.bool("overwrite"),
    });
    return { data: result };
  },

  /* ---- write and check content ----------------------------------------- */

  async compile(ctx) {
    const [{ compileBranch }, { compileJson }] = await Promise.all([
      import("./commands/compile"),
      import("./report"),
    ]);
    const compiled = await compileBranch({
      cwd: ctx.cwd,
      branchId: branchOf(ctx),
      pruneUnknown: ctx.flags.bool("prune-unknown"),
    });
    return { data: compileJson(compiled.branch, compiled.result) };
  },

  async dev(ctx) {
    const { devCommand } = await import("./commands/dev");
    await devCommand({ cwd: ctx.cwd, branchId: branchOf(ctx) });
  },

  async check(ctx) {
    const { checkCommand, formatProblem } = await import("./commands/check");
    const result = await checkCommand({ cwd: ctx.cwd });
    if (result.problems.length === 0) {
      console.log(`Checked ${result.documents} document(s): no problems.`);
      return { data: result };
    }
    if (!ctx.json) {
      for (const problem of result.problems) console.error(formatProblem(problem));
      console.error(`\n${result.problems.length} problem(s).`);
    }
    return { data: result, exitCode: 1 };
  },

  content: (ctx) => listDocuments(ctx, undefined),
  "content list": (ctx) => listDocuments(ctx, ctx.args[0]),

  async "content get"(ctx) {
    const { asObject, formatDocument, parseDocumentId } = await import("./commands/tools");
    const id = parseDocumentId(required(ctx, 0), "content get");
    const doc = await runTools(ctx, async (tools) =>
      asObject(await tools.call("get_content", id), "get_content"),
    );
    if (!ctx.json) console.log(formatDocument(doc));
    return { data: doc };
  },

  async "content search"(ctx) {
    const { asObject, formatSearch } = await import("./commands/tools");
    const input: SearchInput = { query: ctx.args.join(" ") };
    const collection = ctx.flags.string("collection");
    const limit = ctx.flags.number("limit");
    if (collection !== undefined) input.collection = collection;
    if (limit !== undefined) input.limit = limit;
    const answer = await runTools(ctx, async (tools) =>
      asObject(await tools.call("search_content", input), "search_content"),
    );
    if (!ctx.json) for (const line of formatSearch(answer)) console.log(line);
    return { data: answer };
  },

  async "content write"(ctx) {
    const { asObject, formatWrite, parseDocumentId, writeInput } = await import("./commands/tools");
    const id = parseDocumentId(required(ctx, 0), "content write");
    const input = writeInput(
      {
        file: ctx.flags.string("file"),
        data: ctx.flags.string("data"),
        bodyFile: ctx.flags.string("body-file"),
      },
      "content write",
    );
    const answer = await runTools(ctx, async (tools) =>
      asObject(await tools.call("write_content", { ...id, ...input }), "write_content"),
    );
    if (!ctx.json) for (const line of formatWrite(answer)) console.log(line);
    return { data: answer };
  },

  async "content set"(ctx) {
    const { formatSet, parseJsonValue, setField } = await import("./commands/tools");
    const field = ctx.flags.string("field");
    const value = ctx.flags.string("value");
    if (field === undefined || value === undefined) {
      throw new UsageError(
        "graft content set needs --field and --value.",
        "Name the field and its new value, like --field draft --value false. Run `graft content set --help`.",
        { command: "content set" },
      );
    }
    const [collection, ...slugs] = ctx.args;
    const result = await runTools(ctx, (tools) =>
      setField(tools, collection ?? "", slugs, field, parseJsonValue(value)),
    );
    if (!ctx.json) for (const line of formatSet(result)) console.log(line);
    return { data: result, exitCode: result.failed.length > 0 ? 1 : 0 };
  },

  async "content delete"(ctx) {
    const { asObject, parseDocumentId, rethrowWithRetry } = await import("./commands/tools");
    const ref = required(ctx, 0);
    const id = parseDocumentId(ref, "content delete");
    const approval = ctx.flags.string("approval");
    const answer = await runTools(ctx, async (tools) => {
      try {
        const input = approval === undefined ? id : { ...id, approval };
        return asObject(await tools.call("delete_content", input), "delete_content");
      } catch (error) {
        return rethrowWithRetry(error, `graft content delete ${ref}`, ctx.flags.bool("remote"));
      }
    });
    if (!ctx.json) console.log(`Deleted ${id.collection}/${id.slug}.`);
    return { data: answer };
  },

  async compilations(ctx) {
    const { compilationsListCommand, formatCompilation } = await import("./commands/compilations");
    const rows = await compilationsListCommand({ cwd: ctx.cwd, branchId: branchOf(ctx) });
    const data = { branch: branchOf(ctx) ?? "main", compilations: rows };
    if (ctx.json) return { data };
    if (rows.length === 0) console.log("No compilations recorded yet (run graft compile).");
    for (const row of rows) console.log(formatCompilation(row));
    return { data };
  },

  async "asset put"(ctx) {
    const file = required(ctx, 0);
    const key = ctx.args[1];
    const { assetPutCommand } = await import("./commands/asset");
    const result = await assetPutCommand({
      cwd: ctx.cwd,
      file,
      key,
      overwrite: ctx.flags.bool("overwrite"),
    });
    if (ctx.json) return { data: result };
    console.log(`Uploaded ${result.key} (${result.contentType}, ${result.bytes} bytes)`);
    console.log(
      [
        "",
        "Reference it from an `asset` field in frontmatter:",
        `  image:`,
        `    key: ${result.key}`,
        "    alt: describe the image for screen readers",
      ].join("\n"),
    );
    return { data: result };
  },

  async drafts(ctx) {
    const { asObject, formatDrafts } = await import("./commands/tools");
    const answer = await runTools(ctx, async (tools) =>
      asObject(await tools.call("list_drafts"), "list_drafts"),
    );
    if (!ctx.json) for (const line of formatDrafts(answer)) console.log(line);
    return { data: answer };
  },

  async "drafts publish"(ctx) {
    const { asObject } = await import("./commands/tools");
    const input: PublishInput = { paths: ctx.args };
    const message = ctx.flags.string("message");
    if (message !== undefined) input.message = message;
    const resolve = resolutions(ctx.flags.list("resolve"));
    if (Object.keys(resolve).length > 0) input.resolve = resolve;
    const answer = await runTools(ctx, async (tools) =>
      asObject(await tools.call("publish_drafts", input), "publish_drafts"),
    );
    if (!ctx.json) console.log(JSON.stringify(answer, null, 2));
    return { data: answer };
  },

  async "drafts discard"(ctx) {
    const { asObject } = await import("./commands/tools");
    const answer = await runTools(ctx, async (tools) =>
      asObject(await tools.call("discard_drafts", { paths: ctx.args }), "discard_drafts"),
    );
    if (!ctx.json) console.log(`Discarded ${ctx.args.length} draft(s).`);
    return { data: answer };
  },

  /* ---- look into the project -------------------------------------------- */

  async schema(ctx) {
    const { asObject, formatSchema, schemaFor } = await import("./commands/tools");
    const only = ctx.args[0];
    const answer = await runTools(ctx, async (tools) =>
      asObject(await tools.call("describe_schema"), "describe_schema"),
    );
    if (!ctx.json) for (const line of formatSchema(answer, only)) console.log(line);
    return { data: schemaFor(answer, only) };
  },

  async fn(ctx) {
    const { asObject, formatFunctions } = await import("./commands/tools");
    const answer = await runTools(ctx, async (tools) =>
      asObject(await tools.call("list_functions"), "list_functions"),
    );
    if (!ctx.json) for (const line of formatFunctions(answer)) console.log(line);
    return { data: answer };
  },

  async "fn describe"(ctx) {
    const { asObject } = await import("./commands/tools");
    const answer = await runTools(ctx, async (tools) =>
      asObject(
        await tools.call("describe_function", { name: required(ctx, 0) }),
        "describe_function",
      ),
    );
    if (!ctx.json) console.log(JSON.stringify(answer, null, 2));
    return { data: answer };
  },

  async "fn run"(ctx) {
    const { asObject, parseJsonObject, rethrowWithRetry } = await import("./commands/tools");
    const name = required(ctx, 0);
    const raw = ctx.flags.string("input");
    const input: RunInput = {
      name,
      input: raw === undefined ? {} : parseJsonObject(raw, "--input", "fn run"),
    };
    const approval = ctx.flags.string("approval");
    if (approval !== undefined) input.approval = approval;
    const answer = await runTools(ctx, async (tools) => {
      try {
        return asObject(await tools.call("run_function", input), "run_function");
      } catch (error) {
        const retry =
          raw === undefined ? `graft fn run ${name}` : `graft fn run ${name} --input '${raw}'`;
        return rethrowWithRetry(error, retry, ctx.flags.bool("remote"));
      }
    });
    if (!ctx.json) console.log(JSON.stringify(answer, null, 2));
    return { data: answer };
  },

  async explain(ctx) {
    const [{ ERROR_KNOWLEDGE, explainCode }, { closest }] = await Promise.all([
      import("@usegraft/mcp"),
      import("./suggest"),
    ]);
    const code = required(ctx, 0).toUpperCase();
    const explanation = explainCode(code);
    if (!explanation) {
      const suggestion = closest(code, Object.keys(ERROR_KNOWLEDGE));
      throw new UsageError(
        `there is no error code "${code}".`,
        `${suggestion ? `Did you mean \`${suggestion}\`? ` : ""}The error reference lists every code.`,
        { command: "explain", code },
      );
    }
    if (!ctx.json) {
      console.log(
        [
          `${explanation.code}: ${explanation.meaning}`,
          "",
          "Usually because:",
          ...explanation.typicalCauses.map((cause) => `  - ${cause}`),
          "",
          "How to recover:",
          `  ${explanation.howToRecover}`,
        ].join("\n"),
      );
    }
    return { data: explanation };
  },

  async "mcp tools"(ctx) {
    const { formatTools } = await import("./commands/tools");
    const tools = await runTools(ctx, (client) => client.tools());
    if (!ctx.json) for (const line of formatTools(tools)) console.log(line);
    return { data: { tools } };
  },

  async "mcp call"(ctx) {
    const { asObject, parseJsonObject } = await import("./commands/tools");
    const tool = required(ctx, 0);
    const raw = ctx.flags.string("input");
    const input = raw === undefined ? {} : parseJsonObject(raw, "--input", "mcp call");
    const answer = await runTools(ctx, async (tools) => {
      const value = await tools.call(tool, input);
      return asObject(value, tool);
    });
    if (!ctx.json) console.log(JSON.stringify(answer, null, 2));
    return { data: answer };
  },

  /* ---- run Graft --------------------------------------------------------- */

  async mcp(ctx) {
    const { mcpCommand } = await import("./commands/mcp");
    // Blocks until the MCP client disconnects (stdio lifetime).
    await mcpCommand({
      cwd: ctx.cwd,
      branchId: branchOf(ctx),
      elicitApprovals: ctx.flags.bool("elicit-approvals"),
    });
  },

  async serve(ctx) {
    const { serveCommand } = await import("./commands/serve");
    // Blocks until SIGINT/SIGTERM (server lifetime).
    await serveCommand({
      cwd: ctx.cwd,
      branchId: branchOf(ctx),
      port: ctx.flags.number("port"),
      host: ctx.flags.string("host"),
      studio: ctx.flags.bool("studio"),
    });
  },

  async studio(ctx) {
    const { studioCommand } = await import("./commands/studio");
    await studioCommand({
      cwd: ctx.cwd,
      branchId: branchOf(ctx),
      port: ctx.flags.number("port"),
      host: ctx.flags.string("host"),
    });
  },

  async "studio invite"(ctx) {
    const email = required(ctx, 0);
    const { studioInviteCommand } = await import("./commands/studio");
    const invite = await studioInviteCommand({
      cwd: ctx.cwd,
      email,
      name: ctx.flags.string("name"),
      role: ctx.flags.string("role"),
      days: ctx.flags.number("days"),
      url: ctx.flags.string("url"),
    });
    const data = { email, ...invite };
    if (ctx.json) return { data };
    console.log(
      [
        `Sign-in link for ${email} (${invite.role}), valid until ${invite.expiresAt.toISOString().slice(0, 10)}:`,
        "",
        `  ${invite.url}`,
        "",
        "Anyone holding this link can sign in as this person until it expires. Send it",
        "privately. Rotating GRAFT_STUDIO_SECRET revokes every link and session.",
      ].join("\n"),
    );
    return { data };
  },

  async "studio setup-code"(ctx) {
    const { studioSetupCodeCommand } = await import("./commands/studio");
    console.log(await studioSetupCodeCommand({ cwd: ctx.cwd }));
  },

  /* ---- keep content in the database ------------------------------------ */

  async "content import"(ctx) {
    const { contentImportCommand, formatImport } = await import("./commands/content");
    const result = await contentImportCommand({
      cwd: ctx.cwd,
      branchId: branchOf(ctx),
      dryRun: ctx.flags.bool("dry-run"),
    });
    if (!ctx.json) for (const line of formatImport(result)) console.log(line);
    return { data: result };
  },

  async pull(ctx) {
    const { formatPull, pullCommand } = await import("./commands/sync");
    const result = await pullCommand(syncOptions(ctx, false));
    if (!ctx.json) for (const line of formatPull(result)) console.log(line);
    return { data: result };
  },

  async push(ctx) {
    const { formatPush, pushCommand } = await import("./commands/sync");
    const result = await pushCommand(syncOptions(ctx, ctx.flags.bool("dry-run")));
    if (!ctx.json) for (const line of formatPush(result)) console.log(line);
    return { data: result };
  },

  async mirror(ctx) {
    const { formatMirror, mirrorCommand } = await import("./commands/sync");
    const result = await mirrorCommand({ cwd: ctx.cwd, branchId: branchOf(ctx) });
    if (!ctx.json) for (const line of formatMirror(result)) console.log(line);
    return { data: result };
  },

  /* ---- manage the database ---------------------------------------------- */

  async "db migrate"(ctx) {
    const { dbMigrateCommand, formatMigrateResult } = await import("./commands/db");
    const result = await dbMigrateCommand({ cwd: ctx.cwd, dryRun: ctx.flags.bool("dry-run") });
    if (!ctx.json) console.log(formatMigrateResult(result));
    return { data: result };
  },

  async "db claim"(ctx) {
    const { dbClaimCommand } = await import("./commands/db-claim");
    const url = ctx.flags.string("url");
    await dbClaimCommand({ cwd: ctx.cwd, input: !ctx.noInput, ...(url ? { url } : {}) });
  },

  async migrate(ctx) {
    const { migrateCommand } = await import("./commands/migrate");
    const result = await migrateCommand({
      cwd: ctx.cwd,
      branchId: branchOf(ctx),
      apply: ctx.flags.bool("apply"),
    });
    return { data: result };
  },

  async harden(ctx) {
    const { hardenCommand } = await import("./commands/harden");
    const result = await hardenCommand({ cwd: ctx.cwd, role: required(ctx, 0) });
    if (ctx.json) return { data: result };
    console.log(`Hardened runtime role "${result.role}" (${result.statements.length} grants):`);
    for (const statement of result.statements) console.log(`  ${statement}`);
    console.log(
      [
        "",
        "This role can request + consume approvals but can NEVER decide them",
        "(no UPDATE on approvals) or rewrite content projections. Hand its",
        "connection URL to the deployment as DATABASE_URL; keep the operator",
        "URL for graft compile/migrate/branch/merge/approve.",
      ].join("\n"),
    );
    return { data: result };
  },

  /* ---- approve actions --------------------------------------------------- */

  async approvals(ctx) {
    const { approvalsListCommand, formatApproval } = await import("./commands/approvals");
    const site = await remoteSite(ctx);
    if (site) {
      const { withTools } = await import("./tool-runner");
      const answer = await withTools({ cwd: ctx.cwd, remote: site }, (tools) =>
        tools.call("list_approvals"),
      );
      if (!ctx.json) console.log(JSON.stringify(answer, null, 2));
      return { data: typeof answer === "object" && answer !== null ? answer : { approvals: [] } };
    }
    const pending = await approvalsListCommand({ cwd: ctx.cwd });
    const data = { approvals: pending };
    if (ctx.json) return { data };
    if (pending.length === 0) {
      console.log("No pending approvals.");
      return { data };
    }
    console.log(`${pending.length} pending approval(s):\n`);
    for (const row of pending) console.log(`${formatApproval(row)}\n`);
    console.log("Decide with `graft approve <id>` or `graft deny <id>`.");
    return { data };
  },

  approve: (ctx) => decide(ctx, "approved"),
  deny: (ctx) => decide(ctx, "denied"),

  /* ---- work with preview branches --------------------------------------- */

  async branch(ctx) {
    const { branchListCommand, formatBranch } = await import("./commands/branch");
    const rows = await branchListCommand({ cwd: ctx.cwd });
    const data = { branches: rows };
    if (ctx.json) return { data };
    if (rows.length === 0) {
      console.log("No branches registered (main is seeded by migration 0006).");
      return { data };
    }
    for (const row of rows) console.log(formatBranch(row));
    return { data };
  },

  async "branch create"(ctx) {
    const { branchCreateCommand } = await import("./commands/branch");
    const meta = await branchCreateCommand({
      cwd: ctx.cwd,
      name: required(ctx, 0),
      from: ctx.flags.string("from"),
      backend: ctx.flags.string("backend"),
    });
    if (ctx.json) return { data: meta };
    console.log(
      meta.backend === "neon"
        ? [
            `Created neon branch "${meta.name}" from "${meta.parent}" — a physical fork at ${meta.endpointHost}.`,
            `Content is inherited; operational data and approvals start empty on the fork.`,
            `  graft compile --branch ${meta.name}   (routes to the fork automatically)`,
            `Merge it back with \`graft merge ${meta.name}\` when ready.`,
          ].join("\n")
        : [
            `Created branch "${meta.name}" from "${meta.parent}" (${meta.backend} — zero rows copied).`,
            `Reads overlay the parent until the branch writes its own rows:`,
            `  graft compile --branch ${meta.name}`,
            `Merge it back with \`graft merge ${meta.name}\` when ready.`,
          ].join("\n"),
    );
    return { data: meta };
  },

  async "branch drop"(ctx) {
    const name = required(ctx, 0);
    const { branchDropCommand } = await import("./commands/branch");
    const result = await branchDropCommand({ cwd: ctx.cwd, name });
    if (ctx.json) return { data: { name, ...result } };
    const p = result.purged;
    console.log(
      result.backend === "neon"
        ? `Dropped neon branch "${name}" (the fork and its endpoint were deleted).`
        : `Dropped branch "${name}"` +
            (p
              ? ` (purged ${p.content} content, ${p.data} data, ${p.ledger} ledger row(s)).`
              : "."),
    );
    return { data: { name, ...result } };
  },

  async merge(ctx) {
    const { mergeCommand } = await import("./commands/merge");
    const result = await mergeCommand({
      cwd: ctx.cwd,
      branch: required(ctx, 0),
      into: ctx.flags.string("into"),
      apply: ctx.flags.bool("apply"),
    });
    return { data: result };
  },

  /* ---- keep CI cheap ----------------------------------------------------- */

  async "ci changes"(ctx) {
    const { ciChanges, reportChanges } = await import("./commands/ci");
    const base = ctx.flags.string("base");
    const result = await ciChanges({ cwd: ctx.cwd, ...(base ? { base } : {}) });
    for (const line of reportChanges(result)) console.log(line);
    return { data: result };
  },

  async "ci skip-build"(ctx) {
    const { ciSkipBuild } = await import("./commands/ci");
    const base = ctx.flags.string("base");
    const result = await ciSkipBuild({ cwd: ctx.cwd, ...(base ? { base } : {}) });
    console.log(result.reason);
    return { data: result, exitCode: result.skip ? 0 : 1 };
  },

  async "ci init"(ctx) {
    const { ciInit } = await import("./commands/ci");
    for (const line of await ciInit({ cwd: ctx.cwd, overwrite: ctx.flags.bool("overwrite") })) {
      console.log(line);
    }
  },

  /* ---- work with a hosted site ----------------------------------------- */

  async login(ctx) {
    const { formatLogin, loginCommand } = await import("./commands/auth");
    const result = await loginCommand({
      url: required(ctx, 0),
      withToken: ctx.flags.bool("with-token"),
      noInput: ctx.noInput,
    });
    if (!ctx.json) for (const line of formatLogin(result)) console.log(line);
    return { data: result };
  },

  async logout(ctx) {
    const { logoutCommand } = await import("./commands/auth");
    const result = logoutCommand(ctx.args[0]);
    if (!ctx.json) {
      console.log(
        result.removed
          ? `Logged out of ${result.origin}. The token keeps working until it is revoked in Studio under Developer, Agents.`
          : `There was no saved token for ${result.origin}.`,
      );
    }
    return { data: result };
  },

  async "auth status"(ctx) {
    const { authStatusCommand, formatAuthStatus } = await import("./commands/auth");
    const status = await authStatusCommand();
    if (ctx.json) return { data: status };
    for (const line of formatAuthStatus(status)) console.log(line);
    return { data: status, exitCode: status.hosts.some((host) => host.valid) ? 0 : 4 };
  },

  async "auth token"(ctx) {
    const { authTokenCommand } = await import("./commands/auth");
    console.log(authTokenCommand(ctx.args[0]));
  },

  async api(ctx) {
    const { apiCommand, apiRoutes } = await import("./commands/api");
    const site = await apiSite();
    const path = ctx.args[0];
    if (path === undefined) {
      for (const route of await apiRoutes(site.origin, site.token)) {
        console.log(
          `${route.method.padEnd(7)} ${route.path}${route.summary ? `  ${route.summary}` : ""}`,
        );
      }
      return;
    }
    await apiCommand({
      ...site,
      path,
      method: ctx.flags.string("method"),
      rawFields: ctx.flags.list("raw-field"),
      typedFields: ctx.flags.list("field"),
      headers: ctx.flags.list("header"),
      input: ctx.flags.string("input"),
      include: ctx.flags.bool("include"),
      paginate: ctx.flags.bool("paginate"),
      yes: ctx.flags.bool("yes"),
    });
  },

  /* ---- learn the CLI ----------------------------------------------------- */

  async help(ctx) {
    if (ctx.args.length === 0) {
      console.log(rootHelp());
      return;
    }
    const text = topicHelp(ctx.args.join(" ")) ?? commandHelp(ctx.args);
    if (text === undefined) {
      throw new UsageError(
        `no command or help topic called "${ctx.args.join(" ")}".`,
        "Run `graft --help` to list the commands and topics.",
        { topic: ctx.args.join(" ") },
      );
    }
    console.log(text);
  },

  async commands(ctx) {
    const data = describeCli(VERSION);
    if (!ctx.json) console.log(commandList());
    return { data };
  },
} satisfies Record<string, Handler>;

/** Every command's handler, by the id registry.ts gives it. */
export const HANDLERS: ReadonlyMap<string, Handler> = new Map(Object.entries(handlers));

/** search_content's input. */
type SearchInput = {
  query: string;
  collection?: string;
  limit?: number;
};

/** publish_drafts' input. */
type PublishInput = {
  paths: string[];
  message?: string;
  resolve?: Record<string, "mine" | "theirs">;
};

/** run_function's input. */
type RunInput = {
  name: string;
  input: Record<string, unknown>;
  approval?: string;
};

/**
 * Where a tool command runs: the project in this folder, on the branch asked
 * for, or a hosted site (--remote, or GRAFT_URL).
 */
async function target(ctx: CommandContext): Promise<ToolTarget> {
  const branchId = branchOf(ctx);
  const site = await remoteSite(ctx);
  if (site) {
    if (branchId !== undefined) {
      throw new UsageError(
        "--branch works on the project in this folder; a hosted site serves its own branch.",
        "Drop --branch, or add --local to work on this folder's project.",
        { flag: "--branch" },
      );
    }
    return { cwd: ctx.cwd, remote: site };
  }
  return branchId === undefined ? { cwd: ctx.cwd } : { cwd: ctx.cwd, branchId };
}

/** The hosted site this command was pointed at, if any. */
async function remoteSite(
  ctx: CommandContext,
): Promise<{ origin: string; token: string } | undefined> {
  const { resolveTarget } = await import("./remote/hosts");
  const chosen = resolveTarget({
    remote: ctx.flags.bool("remote"),
    local: ctx.flags.bool("local"),
  });
  if (chosen.kind === "local") return undefined;
  if (!ctx.json) console.error(`graft: using ${chosen.origin} (from ${chosen.source})`);
  return { origin: chosen.origin, token: chosen.token };
}

/** The site `graft api` calls: always a hosted one. */
async function apiSite(): Promise<{ origin: string; token: string }> {
  const { resolveTarget } = await import("./remote/hosts");
  const chosen = resolveTarget({ remote: true, local: false });
  if (chosen.kind === "local") throw new Error("resolveTarget answered local for --remote.");
  return { origin: chosen.origin, token: chosen.token };
}

async function listDocuments(
  ctx: CommandContext,
  collection: string | undefined,
): Promise<CommandOutcome> {
  const { formatContentListing, listContent } = await import("./commands/tools");
  const listing = await runTools(ctx, (tools) => listContent(tools, collection));
  if (!ctx.json) for (const line of formatContentListing(listing)) console.log(line);
  return { data: listing };
}

/** `--resolve posts/a.mdx=mine` flags as publish_drafts' `resolve` map. */
function resolutions(values: readonly string[]): Record<string, "mine" | "theirs"> {
  const resolve: Record<string, "mine" | "theirs"> = {};
  for (const value of values) {
    const at = value.lastIndexOf("=");
    const side = value.slice(at + 1);
    if (at <= 0 || (side !== "mine" && side !== "theirs")) {
      throw new UsageError(
        `--resolve ${value} is not <path>=mine or <path>=theirs.`,
        "Name the path and the version to keep, like --resolve posts/launch.mdx=mine.",
        { command: "drafts publish", flag: "--resolve" },
      );
    }
    resolve[value.slice(0, at)] = side;
  }
  return resolve;
}

/** Run the project's MCP tools in this process; loaded only by the commands that use them. */
async function runTools<T>(ctx: CommandContext, fn: (tools: ToolClient) => Promise<T>): Promise<T> {
  const { withTools } = await import("./tool-runner");
  return withTools(await target(ctx), fn);
}

/** A required argument; the parser has already refused a call without it. */
function required(ctx: CommandContext, index: number): string {
  const value = ctx.args[index];
  if (value === undefined) throw new Error(`Argument ${index + 1} is missing.`);
  return value;
}

function syncOptions(ctx: CommandContext, dryRun: boolean): SyncCommandOptions {
  return {
    cwd: ctx.cwd,
    branchId: branchOf(ctx),
    only: [...ctx.args, ...ctx.flags.list("only")],
    force: ctx.flags.bool("force"),
    dryRun,
  };
}

async function decide(
  ctx: CommandContext,
  decision: "approved" | "denied",
): Promise<CommandOutcome> {
  const { decideCommand } = await import("./commands/approvals");
  const row = await decideCommand({ cwd: ctx.cwd, id: required(ctx, 0), decision });
  if (ctx.json) return { data: row };
  console.log(
    `${decision}: ${row.functionName} ${JSON.stringify(row.input)} (by ${row.decidedBy})`,
  );
  if (decision === "approved") {
    console.log(
      `The caller can now retry the exact same request with the header \`x-graft-approval: ${row.id}\` (one-shot).`,
    );
  }
  return { data: row };
}
