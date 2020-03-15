import * as t from "@babel/types";
import { NodePath, Scope } from "@babel/traverse";

import { STATEMENT_EXECUTER_VAR } from "../constants";

export function createStatementUpdater(
  statement: NodePath | t.Statement,
  scope: Scope | t.Identifier,
  name = STATEMENT_EXECUTER_VAR
) {
  const uid =
    scope instanceof Scope ? scope.generateUidIdentifier(name) : scope;
  const node = "node" in statement ? statement.node : statement;
  const block = t.isBlockStatement(node)
    ? node
    : t.blockStatement([node as t.Statement]);

  const nodeToReplace = t.variableDeclaration("const", [
    t.variableDeclarator(uid, t.arrowFunctionExpression([], block))
  ]);
  const callExpression = t.expressionStatement(t.callExpression(uid, []));

  return [nodeToReplace, callExpression, uid];
}
