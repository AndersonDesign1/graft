import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

/**
 * `new Promise((r) => setTimeout(r, 50))` in a test is a guess about how long
 * something takes. It passes on a quiet machine and fails on a loaded CI
 * runner, and when it passes it proves only that the guess was long enough.
 * Await the event itself: a deferred the code under test resolves, the
 * promise it returns, or one event-loop turn (`setImmediate`) when the claim
 * really is "not yet".
 */
function isTimerSleep(node: ESTree.NewExpression): boolean {
  if (node.callee.type !== "Identifier" || node.callee.name !== "Promise") return false;
  const executor = node.arguments[0];
  if (executor === undefined) return false;
  if (executor.type !== "ArrowFunctionExpression" && executor.type !== "FunctionExpression") {
    return false;
  }
  const resolve = executor.params[0];
  if (resolve === undefined || resolve.type !== "Identifier") return false;
  const body = executor.body;
  const call =
    body.type === "CallExpression"
      ? body
      : body.type === "BlockStatement" &&
          body.body.length === 1 &&
          body.body[0]?.type === "ExpressionStatement" &&
          body.body[0].expression.type === "CallExpression"
        ? body.body[0].expression
        : null;
  if (call === null) return false;
  if (call.callee.type !== "Identifier" || call.callee.name !== "setTimeout") return false;
  const [callback] = call.arguments;
  return callback?.type === "Identifier" && callback.name === resolve.name;
}

/** Ban timer sleeps in tests in favor of awaiting the event under test. */
export const noSleepInTestsRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow `new Promise((r) => setTimeout(r, ms))` in tests; await the event, not a delay.",
    },
    messages: {
      sleep:
        "Await the event under test (a deferred, the returned promise, or `setImmediate` for one loop turn) instead of sleeping for a guessed duration.",
    },
  },
  createOnce(context) {
    return {
      NewExpression(node) {
        if (isTimerSleep(node)) context.report({ node, messageId: "sleep" });
      },
    };
  },
});
