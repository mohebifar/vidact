import { NodePath } from "@babel/core";
import * as t from "@babel/types";

import { VariableDescriptor } from "../utils/VariableStatementDependencyManager";
import { PROP_VAR, MEMO_DEPENDENCY_VAR } from "../constants";
import { ensureArrowFunctionBlockStatement } from "./ensureArrowFunctionBlockStatement";
import { getLeftMostMemberExpression } from "../astUtils/getLeftMostMemberExpression";

export function addHookDependencyCheck(
  dependencies: NodePath<t.ArrayExpression>,
  path: NodePath
) {
  const functionPath = path.getFunctionParent();
  const variableDescriptors: VariableDescriptor[] = [];

  const prevValuesZippedWithOriginalValues: [
    t.Identifier,
    t.Expression
  ][] = dependencies.get("elements").map((dependency) => {
    const node = dependency.node;

    if (t.isSpreadElement(node)) {
      throw dependency.buildCodeFrameError(
        "Effect dependencies cannot be spread"
      );
    }

    if (t.isIdentifier(node)) {
      variableDescriptors.push({ type: "local", name: node.name });
    } else if (t.isMemberExpression(node)) {
      const leftMost = getLeftMostMemberExpression(node);

      if (t.isIdentifier(leftMost.object)) {
        if (leftMost.object.name === PROP_VAR) {
          variableDescriptors.push({
            type: "prop",
            name: leftMost.property.name || leftMost.property.value,
          });
        } else {
          variableDescriptors.push({
            type: "local",
            name: leftMost.object.name,
          });
        }
      }
    }

    return [
      functionPath.scope.generateUidIdentifier(MEMO_DEPENDENCY_VAR),
      node,
    ];
  });

  functionPath.get("body").unshiftContainer(
    "body",
    t.variableDeclaration(
      "var",
      prevValuesZippedWithOriginalValues.map(([id]) =>
        t.variableDeclarator(id, t.callExpression(t.identifier("Symbol"), []))
      )
    )
  );

  ensureArrowFunctionBlockStatement(path);
  const body = path.get("body") as NodePath<t.BlockStatement>;

  body.unshiftContainer("body", [
    t.ifStatement(
      prevValuesZippedWithOriginalValues
        .map(([prevValue, newValue]) =>
          t.binaryExpression("===", prevValue, newValue)
        )
        .reduce((a, b) => {
          if (!a) {
            return b;
          }

          return t.logicalExpression("&&", a, b);
        }, undefined),
      t.returnStatement()
    ),

    ...prevValuesZippedWithOriginalValues.map(([prevValue, newValue]) =>
      t.expressionStatement(t.assignmentExpression("=", prevValue, newValue))
    ),
  ]);

  return variableDescriptors;
}
