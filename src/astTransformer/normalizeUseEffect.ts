import { NodePath } from "@babel/core";
import * as t from "@babel/types";

import { createStatementUpdater } from "../astGenerator/createStatementUpdater";
import { ComponentState } from "../plugin";
import { annotate } from "../utils/annotations";
import { USE_EFFECT, EFFECT_DEPENDENCY_VAR, PROP_VAR } from "../constants";

export function normalizeUseEffect(
  functionPath: NodePath<t.FunctionDeclaration>,
  state: ComponentState
) {
  function visitor(path: NodePath<t.CallExpression>) {
    if (
      t.isIdentifier(path.node.callee) &&
      path.node.callee.name === USE_EFFECT
    ) {
      const [effect, dependencies] = path.get("arguments");

      if (!effect || !dependencies) {
        throw path.buildCodeFrameError(`${USE_EFFECT} expects 2 arugments.`);
      }

      if (
        !effect.isFunctionExpression() &&
        !effect.isArrowFunctionExpression()
      ) {
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

      const prevValuesZippedWithOriginalValues: [
        t.Identifier,
        t.Expression
      ][] = dependencies.get("elements").map((dependency) => {
        if (t.isSpreadElement(dependency.node)) {
          throw dependency.buildCodeFrameError(
            "Effect dependencies cannot be spread"
          );
        }

        if (t.isIdentifier(dependency.node)) {
          state.variableStatementDependencyManager.push(
            { type: "local", name: dependency.node.name },
            { type: "node", value: executerPath }
          );
        } else if (
          t.isMemberExpression(dependency.node) &&
          t.isIdentifier(dependency.node.object) &&
          dependency.node.object.name === PROP_VAR &&
          t.isIdentifier(dependency.node.property)
        ) {
          state.variableStatementDependencyManager.push(
            { type: "prop", name: dependency.node.property.name },
            { type: "node", value: executerPath }
          );
        }

        return [
          path.scope.generateUidIdentifier(EFFECT_DEPENDENCY_VAR),
          dependency.node,
        ];
      });

      path
        .getFunctionParent()
        .get("body")
        .unshiftContainer(
          "body",
          t.variableDeclaration(
            "var",
            prevValuesZippedWithOriginalValues.map(([id]) =>
              t.variableDeclarator(
                id,
                t.callExpression(t.identifier("Symbol"), [])
              )
            )
          )
        );

      const body = effect.get("body") as NodePath<t.BlockStatement>;
      body.unshiftContainer("body", [
        t.ifStatement(
          prevValuesZippedWithOriginalValues
            .map(([prevValue, newValue]) => {
              return t.binaryExpression("===", prevValue, newValue);
            })
            .reduce((a, b) => {
              if (!a) {
                return b;
              }

              return t.logicalExpression("&&", a, b);
            }, undefined),
          t.returnStatement()
        ),

        ...prevValuesZippedWithOriginalValues.map(([prevValue, newValue]) =>
          t.expressionStatement(
            t.assignmentExpression("=", prevValue, newValue)
          )
        ),
      ]);
    }
  }

  functionPath
    .get("body")
    .get("body")
    .forEach((statement) => {
      let expression: NodePath<t.Expression>;

      if (
        statement.isExpressionStatement() &&
        (expression = statement.get("expression")) &&
        expression.isCallExpression()
      ) {
        visitor(expression);
      }
    });
}
