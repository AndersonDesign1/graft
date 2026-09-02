/**
 * The commands the landing tells people to run, in one place.
 *
 * They used to be three places: the CTA carried the dlx form with no channel
 * tag, the hero button printed a bare `graft init`, and the hero terminal
 * typed a third spelling. So the front page disagreed with itself and with
 * getting-started, which has named the beta channel since it opened. Someone
 * reading the landing installed 0.2.0, where `approvalPolicy` in config
 * silently does nothing.
 *
 * (Written around the command rather than quoting it: a literal install line
 * in this comment is one install-tag.mjs would rewrite, turning an account of
 * the bug into a claim about the current channel.)
 *
 * scripts/install-tag.mjs rewrites the tag from `.changeset/pre.json` and CI
 * fails when it drifts, so entering and leaving beta moves this file with it.
 * That only works if a command is spelled somewhere the script reads and only
 * once — hence this module, rather than three literals it has to find.
 *
 * The split below is the part worth keeping straight: INIT is what someone
 * with nothing types, so it names the package and carries the channel. The
 * others run a binary the project already has after `init`, so a dist-tag on
 * them would be meaningless.
 */

/** First contact: no repo, nothing installed. Carries the channel tag. */
export const INIT_CMD = "pnpm dlx @usegraft/cli@beta init";

/** Run inside a scaffolded project, against its own devDependency. */
export const COMPILE_CMD = "pnpm graft compile";

/** The agent entry point, once the project exists. */
export const MCP_CMD = "graft mcp";
