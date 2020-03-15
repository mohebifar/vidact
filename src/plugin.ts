import { Visitor } from "@babel/core";
import g from "@babel/generator";
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
import { createPropUpdater } from "./astGenerator/createPropUpdater";
import { createStatementUpdater } from "./astGenerator/createStatementUpdater";
import { normalizePropDefinition } from "./astTransformer/normalizePropDefinition";
import { separateVariableDeclarations } from "./astTransformer/separateVariableDeclarations";
import { normalizeObjectPatternAssignment } from "./astTransformer/normalizeObjectPatternAssignment";
import VariableStatementDependencyManager from "./utils/VariableStatementDependencyManager";

import { PROP_VAR } from "./constants";
import { RuntimeModuleSet, getModuleDeclarations } from "./utils/inlineRuntime";
import { isStatementExecuter, isElementUpdate } from "./utils/variableNames";
import { isSetContent } from "./astExplorer/isSetContent";

export interface State {
  elements: ElementDefenition[];
  moduleDependencies: RuntimeModuleSet;
}

interface ProgramState {
  moduleDependencies: RuntimeModuleSet;
}

function findImmediateStatement(s: NodePath) {
  return (
    s.parentPath.isBlockStatement() &&
    s.parentPath.parentPath.isFunctionDeclaration()
  );
}

function visitFunction(
  fnPath: NodePath<t.FunctionDeclaration>,
  { moduleDependencies }: ProgramState
) {
  if (!isComponent(fnPath)) {
    return fnPath.skip();
  }

  separateVariableDeclarations(fnPath);
  normalizePropDefinition(fnPath);
  normalizeObjectPatternAssignment(fnPath);

  const variableStatementDependencyManager = new VariableStatementDependencyManager();
  const variablesWithDependencies = new Set<string>();
  const declarations = new Map<NodePath, t.Node>();
  const state: State = {
    elements: [],
    moduleDependencies
  };

  function scanDependees(scope: Scope, name: string) {
    if (!scope.hasBinding(name)) {
      return;
    }

    const binding = scope.getBinding(name);

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

  let returnValue: t.Identifier;

  fnPath.traverse({
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
    fnPath.get("body").unshiftContainer(
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
    const [updater, callUpdater] = createStatementUpdater(
      statementPath,
      fnPath.scope
    );

    statementPath.replaceWith(updater);
    statementPath.insertAfter(callUpdater);
  }

  const names: t.Identifier[] = [];

  fnPath.traverse(
    {
      JSXElement(path) {
        const customState: State = {
          elements: [],
          moduleDependencies
        };

        const name = shallowTraverseJSXElement(
          path.node,
          customState,
          path.scope
        );
        names.push(name);

        customState.elements.forEach(definition => {
          const nodePaths: NodePath[] = [];
          const nodes = transformerMap[definition.type](
            definition as any,
            customState
          );

          const nodesList = Array.isArray(nodes) ? nodes : [nodes];

          nodesList.forEach((node, i) => {
            if (node) {
              const parent = path.getStatementParent();
              nodePaths[i] = parent.insertBefore(node)[0];
            }
          });

          if (definition.type === "expr") {
            const nodePath = nodePaths[1];
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

          if (definition.type === "node") {
            const { attributes } = definition;
            if (attributes) {
              attributes.forEach((_, i) => {
                const node = nodes[1 + i];
                const nodePath = nodePaths[1 + i];

                const impactfulIds = getImpactfulIdentifiers(
                  node,
                  path.scope,
                  path
                );

                if (impactfulIds.length > 0) {
                  const [updater, callUpdater] = createStatementUpdater(
                    nodePath,
                    fnPath.scope
                  );
                  nodePath.replaceWith(updater);
                  nodePath.insertAfter(callUpdater);
                }

                impactfulIds.forEach(([type, name]) => {
                  if (name !== definition.identifier.name) {
                    variableStatementDependencyManager.push(
                      { type: type as any, name },
                      { type: "node", value: nodePath }
                    );
                  }
                });
              });
            }
          }

          return nodes;
        });

        path.skip();
        if (path.getStatementParent().isReturnStatement()) {
          if (path.scope === fnPath.scope) {
            returnValue = name;
            path.getStatementParent().remove();
          } else {
            path.replaceWith(name);
          }
        } else if (
          !t.isObjectProperty(path.container) &&
          !t.isVariableDeclarator(path.container)
        ) {
          path.getStatementParent().remove();
        } else {
          path.replaceWith(name);
        }
      }
    },
    state
  );

  function scanForDeepDependencies(path: NodePath<t.VariableDeclaration>) {
    const exportedUpdaters: t.Identifier[] = [];

    path.skip();
    const updaterId = isUpdater(path);
    if (!updaterId) {
      return;
    }
    const allExportedUpdaters: string[] = [];
    const declarator = path.get("declarations")[0];

    declarator.traverse({
      VariableDeclaration(innerPath) {
        if (isUpdater(innerPath)) {
          scanForDeepDependencies(innerPath);
          const names = extractNames(innerPath);
          names.forEach(name => addExportedUpdater(name, innerPath));
          allExportedUpdaters.push(...names);
        }
      }
    });

    if (allExportedUpdaters.length > 0) {
      state.moduleDependencies.add("consolidateExecuters");
      declarator
        .get("id")
        .replaceWith(
          t.arrayPattern([
            updaterId,
            ...allExportedUpdaters.map(name => t.identifier(name))
          ])
        );

      const oldInit = declarator.get("init").node;
      const exportedNames = allExportedUpdaters.map(name =>
        t.identifier(name + "_all")
      );
      declarator.get("init").replaceWith(
        t.callExpression(
          t.arrowFunctionExpression(
            [],
            t.blockStatement([
              t.variableDeclaration(
                "let",
                exportedNames.map(name =>
                  t.variableDeclarator(name, t.arrayExpression([]))
                )
              ),
              t.returnStatement(
                t.arrayExpression([
                  oldInit,
                  ...exportedNames.map(name =>
                    t.callExpression(t.identifier("consolidateExecuters"), [
                      name
                    ])
                  )
                ])
              )
            ])
          ),
          []
        )
      );
    }

    function isUpdater(path: NodePath<t.VariableDeclaration>) {
      const { id } = path.node.declarations[0];

      return t.isIdentifier(id) &&
        (isStatementExecuter(id.name) || isElementUpdate(id.name))
        ? id
        : undefined;
    }

    function extractNames(path: NodePath<t.VariableDeclaration>): string[] {
      const { id } = path.node.declarations[0];

      if (t.isIdentifier(id)) {
        return [id.name];
      } else if (t.isArrayPattern(id)) {
        return (id.elements as t.Identifier[]).map(({ name }) => name);
      }

      return [];
    }

    function addExportedUpdater(name: string, parent: NodePath) {
      const updaterName = name + "_all";
      const updaterId = t.identifier(updaterName);

      parent.insertAfter(
        t.expressionStatement(
          t.callExpression(
            t.memberExpression(updaterId, t.identifier("push")),
            [t.identifier(name)]
          )
        )
      );

      exportedUpdaters.push(updaterId);
    }
  }

  fnPath.traverse({
    VariableDeclaration: scanForDeepDependencies
  });

  const componentElement = createComponentElement(
    returnValue,
    createPropUpdater(variableStatementDependencyManager, fnPath.get("body"))
  );

  state.moduleDependencies.add("propUpdater");
  fnPath.get("body").node.body.push(t.returnStatement(componentElement));
  fnPath.skip();
}

export default function() {
  const visitor: Visitor<any> = {
    Program(path) {
      const state: ProgramState = {
        moduleDependencies: new Set()
      };

      path.traverse({ FunctionDeclaration: visitFunction }, state);
      const declarations = getModuleDeclarations(state.moduleDependencies);
      path.unshiftContainer("body", declarations);
    }
  };

  return {
    name: "carrot",
    inherits: require("@babel/plugin-syntax-jsx").default,
    visitor
  };
}
