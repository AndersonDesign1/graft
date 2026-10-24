import { describe, expect, it } from "vitest";
import { promptsDisabled, useColor } from "./term";

describe("useColor", () => {
  it.each([
    [{}, true, true],
    [{}, false, false],
    [{ NO_COLOR: "1" }, true, false],
    [{ NO_COLOR: "1", FORCE_COLOR: "1" }, true, false],
    [{ FORCE_COLOR: "1" }, false, true],
    [{ FORCE_COLOR: "0" }, false, false],
    [{ CLICOLOR_FORCE: "1" }, false, true],
    [{ CLICOLOR: "0" }, true, false],
    [{ TERM: "dumb" }, true, false],
  ])("%j on a terminal=%s is %s", (env, isTTY, expected) => {
    expect(useColor(env, isTTY)).toBe(expected);
  });
});

describe("promptsDisabled", () => {
  it.each([
    [{}, false, false],
    [{}, true, true],
    [{ GRAFT_PROMPT_DISABLED: "1" }, false, true],
    [{ GRAFT_PROMPT_DISABLED: "0" }, false, false],
  ])("%j with --no-input=%s is %s", (env, flag, expected) => {
    expect(promptsDisabled(env, flag)).toBe(expected);
  });
});
