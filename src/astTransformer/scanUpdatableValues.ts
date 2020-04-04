import { NodePath } from "@babel/core";
import { Scope } from "@babel/traverse";
import * as t from "@babel/types";

import { ComponentState } from "../plugin";
import {
  PROP_VAR,
  STATE_VAR,
  KEY_STATE_UPDATER,
  USE_STATE
} from "../constants";
import { declarationToAssignment } from "./declarationToAssignment";

export function scanUpdatableValues(fnPath: NodePath, state: ComponentState) {
  const { variableStatementDependencyManager } = state;

  fnPath.traverse(
    {
      MemberExpression(objectReferencePath) {
        const { node } = objectReferencePath;
        const { object, property } = node;

        if (!t.isIdentifier(object) || object.name !== PROP_VAR) {
          return;
        }

        const immediateStatement = objectReferencePath.findParent(
          findImmediateStatement
        );

        if (immediateStatement.isVariableDeclaration()) {
          // TODO: Check for object and array destruct
          const { id } = immediateStatement.node.declarations[0];

          if (!t.isIdentifier(id)) {
            return;
          }

          variableStatementDependencyManager.push(
            { type: "prop", name: property.name },
            { type: "local", name: id.name }
          );

          scanDependees(objectReferencePath.scope, id.name);
        } else if (
          !immediateStatement.isReturnStatement() &&
          (!immediateStatement.isExpressionStatement() ||
            !immediateStatement.get("expression").isAssignmentExpression())
        ) {
          variableStatementDependencyManager.push(
            { type: "prop", name: property.name },
            { type: "node", value: immediateStatement }
          );

          immediateStatement.traverse({
            AssignmentExpression(assignPath) {
              const leftPath = assignPath.get("left");
              if (leftPath.isIdentifier()) {
                variableStatementDependencyManager.push(
                  { type: "prop", name: property.name },
                  { type: "local", name: leftPath.node.name }
                );
                scanDependees(objectReferencePath.scope, leftPath.node.name);
              }
            }
          });
        }
      },
      CallExpression(callExpressionPath, state) {
        const callee = callExpressionPath.get("callee");
        if (!callee.isIdentifier() || callee.node.name !== USE_STATE) {
          return callExpressionPath.skip();
        }

        const statement = callExpressionPath.getStatementParent();

        if (!statement.isVariableDeclaration()) {
          return callExpressionPath.skip();
        }

        const tupleId = fnPath.scope.generateUidIdentifier("s");

        const declarations = statement.get("declarations");
        const declarator = declarations.find(declarator => {
          const init = declarator.get("init");
          return init.node === callExpressionPath.node;
        });
        statement.node.kind = "let";
        const left = declarator.get("id");
        const initialValue = callExpressionPath.node
          .arguments[0] as t.Expression;

        const valueNode = t.memberExpression(t.identifier(STATE_VAR), tupleId);
        const setterNode = t.arrowFunctionExpression(
          [t.identifier("value")],
          t.blockStatement([
            t.expressionStatement(
              t.callExpression(t.identifier(KEY_STATE_UPDATER), [
                t.objectExpression([
                  t.objectProperty(tupleId, t.identifier("value"))
                ])
              ])
            )
          ])
        );

        if (left.isArrayPattern()) {
          const [valueName, setterName] = left
            .get("elements")
            .map(({ node }) => (node as t.Identifier).name);
          left.replaceWith(tupleId);
          state.variablesWithDependencies.add(valueName);
          const assignValue = t.expressionStatement(
            t.assignmentExpression("=", t.identifier(valueName), valueNode)
          );
          const assignValuePath = callExpressionPath
            .getStatementParent()
            .insertAfter(assignValue)[0];
          callExpressionPath
            .getStatementParent()
            .insertAfter(
              t.variableDeclaration("const", [
                t.variableDeclarator(t.identifier(setterName), setterNode)
              ])
            );

          variableStatementDependencyManager.push(
            { type: "state", name: tupleId.name },
            { type: "local", name: valueName }
          );
          variableStatementDependencyManager.push(
            { type: "local", name: valueName },
            { type: "node", value: assignValuePath }
          );

          scanDependees(callExpressionPath.scope, valueName, true);
          state.state.push({
            originalName: valueName,
            name: tupleId,
            initialValue
          });
          statement.remove();
        }
      }
    },
    state
  );

  function findImmediateStatement(s: NodePath) {
    return (
      s.parentPath.isBlockStatement() &&
      s.parentPath.parentPath.isFunctionDeclaration()
    );
  }

  function scanDependees(scope: Scope, name: string, skipDefinition = false) {
    if (!scope.hasBinding(name)) {
      return;
    }

    const binding = scope.getBinding(name);

    Object.values(binding.referencePaths).forEach(n => {
      const container = n.getStatementParent();

      const expression = container.isExpressionStatement()
        ? container.get("expression")
        : container;

      const statement = n.findParent(findImmediateStatement);

      let lVal: NodePath<t.LVal>;
      if (expression.isVariableDeclaration()) {
        lVal = expression.get("declarations")[0].get("id");
      } else if (expression.isAssignmentExpression()) {
        lVal = expression.get("left");
      }

      if (statement.isVariableDeclaration()) {
        declarationToAssignment(statement).forEach(name =>
          state.variablesWithDependencies.add(name)
        );
      }

      if (lVal) {
        const id = lVal as NodePath<t.Identifier>;
        const { name: idName } = id.node;

        if (idName !== name) {
          scanDependees(scope, idName);

          variableStatementDependencyManager.push(
            { type: "local", name },
            { type: "local", name: idName }
          );
        }
      }

      if (!statement.isReturnStatement()) {
        statement.traverse({
          AssignmentExpression(assignPath) {
            const leftPath = assignPath.get("left");
            if (leftPath.isIdentifier()) {
              variableStatementDependencyManager.push(
                { type: "local", name },
                { type: "local", name: leftPath.node.name }
              );
              scanDependees(scope, leftPath.node.name);
            }
          }
        });

        variableStatementDependencyManager.push(
          { type: "local", name },
          { type: "node", value: statement }
        );
      }
    });

    if (!skipDefinition) {
      const declaration = binding.path.findParent(findImmediateStatement);

      state.variablesWithDependencies.add(name);
      variableStatementDependencyManager.push(
        { type: "local", name },
        { type: "node", value: declaration }
      );

      // declaration.replaceWith(
      //   t.assignmentExpression("=", declarator.node.id, declarator.node.init)
      // );
      if (declaration.isVariableDeclaration()) {
        state.looseAssignments.add(declaration);
      }
    }
  }
}
