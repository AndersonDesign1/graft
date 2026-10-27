import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

/**
 * A skipped test reports as neither passing nor failing, so a suite with one
 * stays green while the behavior it covered goes unchecked. `it.skip` and
 * `describe.skip` need a comment on the line above saying why and what brings
 * the test back. Conditional skips (`skipIf`, `runIf`) say why in their
 * condition and are not affected.
 */
const testFunctions = new Set(["it", "test", "describe"]);
const skipMethods = new Set(["skip", "todo"]);

function staticSkip(callee: ESTree.Expression): string | null {
  if (callee.type !== "MemberExpression" || callee.computed) return null;
  if (callee.object.type !== "Identifier" || !testFunctions.has(callee.object.name)) return null;
  if (callee.property.type !== "Identifier" || !skipMethods.has(callee.property.name)) return null;
  return `${callee.object.name}.${callee.property.name}`;
}

/** Require a reason, in a comment directly above, for every static test skip. */
export const noUnreasonedTestSkipRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Require a comment above `it.skip`, `describe.skip` and `.todo` saying why.",
    },
    messages: {
      unreasoned:
        "Say why `{{call}}` is skipped, and what brings it back, in a comment on the line above.",
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        if (node.callee.type === "Super" || node.callee.type === "V8IntrinsicExpression") return;
        const call = staticSkip(node.callee);
        if (call === null) return;
        const statement = node.parent?.type === "ExpressionStatement" ? node.parent : node;
        if (context.sourceCode.getCommentsBefore(statement).length > 0) return;
        context.report({ node, messageId: "unreasoned", data: { call } });
      },
    };
  },
});
