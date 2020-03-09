import { Visitor } from "@babel/core";
import { NodePath, Scope } from "@babel/traverse";
import * as t from "@babel/types";

import { getImpactfulIdentifiers } from "./astExplorer/getImpactfulIdentifiers";
import { shallowTraverseJSXElement } from "./astExplorer/visitJSXElement";
import { isComponent } from "./astExplorer/isComponent";
import {
  createComponentElement,
  ElementDefenition,
  transformerMap
} from "./astGenerator/elementDefinitions";
import { createUpdateProps } from "./astGenerator/updateProps";
import { normalizePropDefinition } from "./astTransformer/normalizePropDefinition";
import { separateVariableDeclarations } from "./astTransformer/separateVariableDeclarations";
import { normalizeObjectPatternAssignment } from "./astTransformer/normalizeObjectPatternAssignment";
import VariableStatementDependencyManager from "./utils/VariableStatementDependencyManager";

import { PROP_VAR } from "./constants";

function findImmediateStatement(s: NodePath) {
  return (
    s.parentPath.isBlockStatement() &&
    s.parentPath.parentPath.isFunctionDeclaration()
  );
}

export default function() {
  const visitor: Visitor<any> = {
    FunctionDeclaration(path) {
      if (!isComponent(path)) {
        return path.skip();
      }

      path.traverse({
        VariableDeclaration(p) {
          separateVariableDeclarations(p);
        }
      });

      const state = {
        elements: []
      };

      normalizePropDefinition(path);
      normalizeObjectPatternAssignment(path);

      const variableStatementDependencyManager = new VariableStatementDependencyManager();

      const variablesWithDependencies = new Set<string>();
      const declarations = new Map<NodePath, t.Node>();

      function scanDependees(scope: Scope, name: string) {
        const binding = scope.getBinding(name);

        if (!binding) {
          return;
        }

        const declaration = binding.path.findParent(findImmediateStatement);
        const declarator = binding.path as NodePath<t.VariableDeclarator>;

        variablesWithDependencies.add(name);
        variableStatementDependencyManager.push(
          { type: "local", name },
          { type: "node", value: declaration }
        );

        declarations.set(
          declaration,
          t.assignmentExpression("=", declarator.node.id, declarator.node.init)
        );

        Object.values(binding.referencePaths).forEach(n => {
          const container = n.getStatementParent();

          const expression = container.isExpressionStatement()
            ? container.get("expression")
            : container;

          let lVal: NodePath<t.LVal>;
          if (expression.isVariableDeclaration()) {
            lVal = expression.get("declarations")[0].get("id");
          } else if (expression.isAssignmentExpression()) {
            lVal = expression.get("left");
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

            if (
              expression.isAssignmentExpression() &&
              /(\+|\-|\*|\/|\&|\&\&|\||\|\|)=$/.test(expression.node.operator)
            ) {
            }
          }

          const statement = n.findParent(findImmediateStatement);

          if (!statement.isReturnStatement()) {
            variableStatementDependencyManager.push(
              { type: "local", name },
              { type: "node", value: statement }
            );
          }
        });
      }

      path.traverse({
        MemberExpression(objectReferencePath) {
          const { node } = objectReferencePath;
          const { object, property } = node;

          if (!t.isIdentifier(object) || object.name !== PROP_VAR) {
            return;
          }

          let variableDeclaration = objectReferencePath.findParent(p =>
            p.isVariableDeclaration()
          ) as NodePath<t.VariableDeclaration>;

          if (!variableDeclaration) {
            return;
          }

          // TODO: Check for object ad array destruct
          const { id } = variableDeclaration.node.declarations[0];

          if (!t.isIdentifier(id)) {
            return;
          }

          variableStatementDependencyManager.push(
            { type: "prop", name: property.name },
            { type: "local", name: id.name },
            id.loc && id.loc.start
          );

          scanDependees(objectReferencePath.scope, id.name);
        }
      });

      if (variablesWithDependencies.size > 0) {
        path.get("body").unshiftContainer(
          "body",
          t.variableDeclaration(
            "let",
            Array.from(variablesWithDependencies).map(name =>
              t.variableDeclarator(t.identifier(name))
            )
          )
        );
      }

      for (const [declaration, toReplaceWith] of declarations.entries()) {
        declaration.replaceWith(toReplaceWith);
      }

      for (const statementPath of variableStatementDependencyManager.statements.values()) {
        const uid = path.scope.generateUidIdentifier("statement");
        const nodeToReplace = t.variableDeclaration("const", [
          t.variableDeclarator(
            uid,
            t.arrowFunctionExpression(
              [],
              t.blockStatement([statementPath.node as any])
            )
          )
        ]);
        statementPath.replaceWith(nodeToReplace);
        statementPath.insertAfter(t.callExpression(uid, []));
      }

      path.traverse(
        {
          JSXElement(path, state) {
            state.elements.push(
              path.node.openingElement.name as t.JSXIdentifier
            );

            const customState: { elements: ElementDefenition[] } = {
              elements: []
            };

            const name = shallowTraverseJSXElement(
              path.node,
              customState,
              path.scope
            );

            customState.elements
              .flatMap(definition => {
                const nodes = transformerMap[definition.type](
                  definition as any
                );

                if (definition.type === "expr") {
                  const nodePath = new NodePath(path.hub, path.parent);
                  nodePath.node = nodes[1];
                  getImpactfulIdentifiers(
                    definition.expression,
                    path.scope,
                    path
                  ).forEach(([type, name]) => {
                    variableStatementDependencyManager.push(
                      { type: type as any, name },
                      { type: "node", value: nodePath }
                    );
                  });
                }

                return nodes;
              })
              .forEach(node => {
                if (node) {
                  path.getStatementParent().insertBefore(node);
                }
              });
            const componentElement = createComponentElement(name);

            path.skip();
            path.replaceWith(componentElement);
          }
        },
        state
      );

      path
        .get("body")
        .node.body.push(
          createUpdateProps(
            variableStatementDependencyManager,
            path.get("body")
          )
        );
      path.skip();
    }
  };

  return {
    name: "carrot",
    inherits: require("@babel/plugin-syntax-jsx").default,
    visitor
  };
}
