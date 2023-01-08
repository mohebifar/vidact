import ts from "typescript";
import { compareSymbolName } from "./compareSymbolName";

export function isHookCall(
  node: ts.Node,
  hookName?: string | RegExp
): node is ts.CallExpression {
  const identifierMatchesHookName = (node: ts.Identifier) =>
    hookName &&
    (typeof hookName === "string"
      ? node.getText() === hookName
      : hookName.test(node.getText()));

  const expressionMatchesGivenHookName = (expression: ts.Expression) =>
    ts.isIdentifier(expression) ? identifierMatchesHookName(expression) : false;

  if (!ts.isCallExpression(node)) {
    return false;
  }

  if (hookName) {
    if (expressionMatchesGivenHookName(node.expression)) {
      return true;
    }
    // TODO: Support member call expression React.useHook()
    return false;
  }

  return true;
}
