import { Visitor } from "@babel/core";
import { NodePath, Scope } from "@babel/traverse";
import * as t from "@babel/types";

import { getImpactfulIdentifiers } from "./astExplorer/getImpactfulIdentifiers";
import {
  createComponentElement,
  ElementDefenition,
  transformerMap
} from "./astGenerator/elementDefinitions";
import { createUpdateProps } from "./astGenerator/updateProps";
import { normalizePropDefinition } from "./astTransformer/normalizePropDefinition";
import VariableStatementDependencyManager from "./utils/VariableStatementDependencyManager";

import { PROP_VAR } from "./constants";

function findImmediateStatement(s: NodePath) {
  return (
    s.parentPath.isBlockStatement() &&
    s.parentPath.parentPath.isFunctionDeclaration()
  );
}

function shallowTraverseJSXElement(
  element:
    | t.JSXText
    | t.JSXExpressionContainer
    | t.JSXSpreadChild
    | t.JSXElement
    | t.JSXFragment
    | t.JSXEmptyExpression,
  state: {
    elements: ElementDefenition[];
  },
  scope: Scope,
  namePrefix = "el"
) {
  if (t.isJSXText(element) && element.value.trim() === "") {
    return undefined;
  }
  const identifier = scope.generateUidIdentifier(namePrefix);

  switch (element.type) {
    case "JSXElement":
      const tagIdentifier = element.openingElement.name as t.JSXIdentifier;
      const children = element.children
        .map(child =>
          shallowTraverseJSXElement(child, state, scope, identifier.name)
        )
        .filter(value => value);
      state.elements.push({
        type: "node",
        tag: tagIdentifier.name,
        identifier,
        children
      });
      break;
    case "JSXText":
      state.elements.push({
        type: "text",
        value: element.value.trim(),
        identifier
      });
      break;
    case "JSXExpressionContainer":
      state.elements.push({
        type: "expr",
        expression: element.expression,
        identifier
      });
      break;
    default:
      console.log(element);
  }

  return identifier;
}

export default function() {
  const visitor: Visitor<any> = {
    FunctionDeclaration(path) {
      const state = {
        elements: []
      };

      normalizePropDefinition(path);

      const variableStatementDependencyManager = new VariableStatementDependencyManager();

      const variablesWithDependencies = new Set<string>();
      const declarations = new Map<NodePath, t.Node>();

      path.traverse({
        MemberExpression(objectReferencePath) {
          const { node } = objectReferencePath;
          const { object, property } = node;

          if (t.isIdentifier(object) && object.name === PROP_VAR) {
            let statement = objectReferencePath.findParent(p =>
              p.isVariableDeclaration()
            ) as NodePath<t.VariableDeclaration>;
            if (!statement) {
              return;
            }

            // TODO: Check
            const id = statement.node.declarations[0].id;

            if (t.isIdentifier(id)) {
              variableStatementDependencyManager.push(
                "prop",
                property.name,
                "local",
                id.name,
                id.loc && id.loc.start
              );

              const binding = objectReferencePath.scope.bindings[id.name];
              if (binding) {
                const declaration = binding.path.findParent(
                  findImmediateStatement
                );
                const declarator = binding.path as NodePath<
                  t.VariableDeclarator
                >;
                // console.log(binding.path.node)
                variableStatementDependencyManager.push(
                  "local",
                  id.name,
                  "node",
                  declaration
                );
                declarations.set(
                  declaration,
                  t.assignmentExpression(
                    "=",
                    declarator.node.id,
                    declarator.node.init
                  )
                );
                variablesWithDependencies.add(id.name);

                Object.values(binding.referencePaths).forEach(n => {
                  const statement = n.findParent(findImmediateStatement);

                  if (!statement.isReturnStatement()) {
                    variableStatementDependencyManager.push(
                      "local",
                      id.name,
                      "node",
                      statement
                    );
                  }
                });
              }
            }
          }
        }
      });

      path.get("body").node.body.unshift(
        t.variableDeclaration(
          "let",
          Array.from(variablesWithDependencies).map(name =>
            t.variableDeclarator(t.identifier(name))
          )
        )
      );

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
                  ).forEach(([type, key]) => {
                    variableStatementDependencyManager.push(
                      type,
                      key,
                      "node",
                      nodePath
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
        .node.body.push(createUpdateProps(variableStatementDependencyManager));
      path.skip();
    }
  };

  return {
    name: "carrot",
    inherits: require("@babel/plugin-syntax-jsx").default,
    visitor
  };
}
