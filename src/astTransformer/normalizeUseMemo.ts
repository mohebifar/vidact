import { NodePath } from "@babel/core";
import * as t from "@babel/types";

import { declarationToAssignment } from "./declarationToAssignment";
import { ComponentState } from "../plugin";
import { annotate } from "../utils/annotations";
import { USE_MEMO, USE_CALLBACK } from "../constants";
import { addHookDependencyCheck } from "./addHookDependencyCheck";

export function normalizeUseMemo(
  path: NodePath<t.CallExpression>,
  state: ComponentState
) {
  if (!t.isIdentifier(path.node.callee)) {
    return;
  }
  const calleeName = path.node.callee.name;

  const isMemo = calleeName === USE_MEMO;
  const isCallback = calleeName === USE_CALLBACK;

  if (!isCallback && !isMemo) {
    return;
  }

  const [memoizedValue, dependencies] = path.get("arguments");

  if (!memoizedValue || !dependencies) {
    throw path.buildCodeFrameError(`${calleeName} expects 2 arugments.`);
  }

  if (
    !memoizedValue.isFunctionExpression() &&
    !memoizedValue.isArrowFunctionExpression()
  ) {
    throw path.buildCodeFrameError(
      `The first argument of ${calleeName} must be a function expression.`
    );
  }

  if (!dependencies.isArrayExpression()) {
    throw path.buildCodeFrameError(
      `The second argument of ${calleeName} must be an array of dependencies.`
    );
  }

  const statement = path.getStatementParent();
  annotate(statement, calleeName);
  annotate(statement, "locked");

  if (isMemo) {
    path.replaceWith(t.callExpression(memoizedValue.node, []));
  } else {
    path.replaceWith(memoizedValue.node);
  }

  if (dependencies.get("elements").length === 0) {
    return;
  }

  if (!statement.isVariableDeclaration()) {
    throw statement.buildCodeFrameError(
      `${calleeName} must be used with variable declaration`
    );
  }

  const names = declarationToAssignment(statement);
  names.forEach((name) => {
    state.variablesWithDependencies.add(name);
    state.variableStatementDependencyManager.push(
      { type: "local", name },
      { type: "node", value: statement }
    );
  });

  const descriptors = addHookDependencyCheck(dependencies, memoizedValue);

  descriptors.forEach((descriptor) => {
    names.forEach((name) => {
      state.variableStatementDependencyManager.push(descriptor, {
        type: "local",
        name,
      });
    });
  });
}
