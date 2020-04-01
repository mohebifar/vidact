import { NodePath } from "@babel/core";
import * as t from "@babel/types";
import { isElementVar } from "../utils/variableNames";


// @deprecated
export function isSetContent(path: NodePath) {
  let expression: NodePath<t.AssignmentExpression>;
  if (
    path.isExpressionStatement() &&
    path.get("expression").isAssignmentExpression()
  ) {
    expression = path.get("expression") as NodePath<t.AssignmentExpression>;
  } else if (path.isAssignmentExpression()) {
    expression = path;
  } else {
    return false;
  }

  const left = expression.get("left");
  if (!left.isIdentifier() || !isElementVar(left.node.name)) {
    return false;
  }

  const right = expression.get("right");
  if (!right.isCallExpression()) {
    return false;
  }

  const callee = right.get("callee");
  return callee.isIdentifier() && callee.node.name === "setContent";
}
