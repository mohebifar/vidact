import { NodePath } from "@babel/core";
import * as t from "@babel/types";

import { createStatementUpdater } from "../astGenerator/createStatementUpdater";
import { ComponentState } from "../plugin";
import { annotate } from "../utils/annotations";
import { USE_EFFECT } from "../constants";
import { addHookDependencyCheck } from "./addHookDependencyCheck";

export function normalizeUseEffect(
  path: NodePath<t.CallExpression>,
  state: ComponentState
) {
  if (
    t.isIdentifier(path.node.callee) &&
    path.node.callee.name === USE_EFFECT
  ) {
    const [effect, dependencies] = path.get("arguments");

    if (!effect || !dependencies) {
      throw path.buildCodeFrameError(`${USE_EFFECT} expects 2 arugments.`);
    }

    if (!effect.isFunctionExpression() && !effect.isArrowFunctionExpression()) {
      throw path.buildCodeFrameError(
        `The first argument of ${USE_EFFECT} must be a function expression.`
      );
    }

    if (!dependencies.isArrayExpression()) {
      throw path.buildCodeFrameError(
        `The second argument of ${USE_EFFECT} must be an array of dependencies.`
      );
    }
    const statement = path.getStatementParent();

    annotate(statement, "useEffect");
    annotate(statement, "locked");
    const callExpressionStatement = t.expressionStatement(
      t.callExpression(effect.node, [])
    );
    const [executer, callExecuter] = createStatementUpdater(
      callExpressionStatement,
      statement.scope
    );
    const [executerPath] = (statement.replaceWith(
      executer
    ) as never) as NodePath<t.Statement>[];
    state.finally.push(callExecuter);

    if (dependencies.get("elements").length === 0) {
      return;
    }

    const descriptors = addHookDependencyCheck(dependencies, effect);

    descriptors.forEach((descriptor) => {
      state.variableStatementDependencyManager.push(descriptor, {
        type: "node",
        value: executerPath,
      });
    });
  }
}
