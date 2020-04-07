import { NodePath } from "@babel/core";
import * as t from "@babel/types";

export function ensureArrowFunctionBlockStatement(path: NodePath) {
  if (!path.isArrowFunctionExpression()) {
    return;
  }

  const body = path.get("body");

  if (!t.isBlockStatement(body.node)) {
    body.replaceWith(t.blockStatement([t.returnStatement(body.node)]));
  }
}
