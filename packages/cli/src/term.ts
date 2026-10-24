/**
 * What the terminal on the other end can take: color, and questions.
 *
 * Both are decided from the environment rather than guessed per command, so a
 * script or an agent gets the same plain, prompt-free CLI everywhere.
 */

/**
 * Color only for a person at a terminal, unless the environment says
 * otherwise. NO_COLOR (https://no-color.org) and TERM=dumb turn it off;
 * FORCE_COLOR or CLICOLOR_FORCE turn it on even when piped; CLICOLOR=0 turns
 * it off on a terminal.
 */
export function useColor(env: NodeJS.ProcessEnv, isTTY: boolean | undefined): boolean {
  if (env.NO_COLOR) return false;
  if (isSet(env.FORCE_COLOR) || isSet(env.CLICOLOR_FORCE)) return true;
  if (env.TERM === "dumb" || env.CLICOLOR === "0") return false;
  return Boolean(isTTY);
}

/**
 * Whether questions are off: --no-input, or GRAFT_PROMPT_DISABLED for every
 * command at once. A command still asks only on a terminal; when it cannot
 * ask, it says which flag answers the question instead.
 */
export function promptsDisabled(env: NodeJS.ProcessEnv, noInputFlag: boolean): boolean {
  return noInputFlag || isSet(env.GRAFT_PROMPT_DISABLED);
}

/** Set to anything but empty, "0" or "false". */
function isSet(value: string | undefined): boolean {
  return value !== undefined && value !== "" && value !== "0" && value !== "false";
}
