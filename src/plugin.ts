import { Visitor } from "@babel/core";
import { NodePath } from "@babel/traverse";
import * as t from "@babel/types";
// @ts-ignore
import g from "@babel/generator";

import { getImpactfulIdentifiers } from "./astExplorer/getImpactfulIdentifiers";
import { shallowTraverseJSXElement } from "./astExplorer/visitJSXElement";
import { isComponent } from "./astExplorer/isComponent";
import {
  createComponentElement,
  ElementDefenition,
  transformerMap
} from "./astGenerator/elementDefinitions";
import { createUpdatableUpdater } from "./astGenerator/createUpdatableUpdater";
import { createStatementUpdater } from "./astGenerator/createStatementUpdater";
import { normalizePropDefinition } from "./astTransformer/normalizePropDefinition";
import { separateVariableDeclarations } from "./astTransformer/separateVariableDeclarations";
import { normalizeObjectPatternAssignment } from "./astTransformer/normalizeObjectPatternAssignment";
import VariableStatementDependencyManager from "./utils/VariableStatementDependencyManager";

import { RuntimeModuleSet, getModuleDeclarations } from "./utils/inlineRuntime";
import { scanUpdatableValues } from "./astTransformer/scanUpdatableValues";
import { scanForDeepDependencies } from "./astTransformer/scanDeepDependencies";
import {
  InternalStateRecord,
  createStateDefinition
} from "./astGenerator/createStateDefinition";

export interface ComponentState {
  moduleDependencies: RuntimeModuleSet;

  state?: InternalStateRecord[];
  variableStatementDependencyManager?: VariableStatementDependencyManager;
  variablesWithDependencies?: Set<string>;
}

export interface JSXState {
  elements: ElementDefenition[];
  moduleDependencies: RuntimeModuleSet;
}

interface ProgramState {
  moduleDependencies: RuntimeModuleSet;
}

function visitFunction(
  fnPath: NodePath<t.FunctionDeclaration>,
  { moduleDependencies }: ProgramState
) {
  if (!isComponent(fnPath)) {
    return fnPath.skip();
  }

  const variableStatementDependencyManager = new VariableStatementDependencyManager();
  const state: ComponentState = {
    state: [],
    moduleDependencies,
    variablesWithDependencies: new Set<string>(),
    variableStatementDependencyManager
  };

  // Separate variable declarations with multiple declarators
  separateVariableDeclarations(fnPath);

  // Rename prop object and move param destruct to body block
  normalizePropDefinition(fnPath);

  // Convert object pattern assignments to identifier assignments
  normalizeObjectPatternAssignment(fnPath);

  // Traverse all state and prop references
  scanUpdatableValues(fnPath, state);

  // Declare variables defined inside updaters in the function scope
  if (state.variablesWithDependencies.size > 0) {
    fnPath.get("body").unshiftContainer(
      "body",
      t.variableDeclaration(
        "let",
        Array.from(state.variablesWithDependencies).map(name =>
          t.variableDeclarator(t.identifier(name))
        )
      )
    );
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

  let returnValue: t.Expression;

  fnPath.traverse({
    JSXElement(path) {
      const state: JSXState = {
        elements: [],
        moduleDependencies
      };

      const name = shallowTraverseJSXElement(path.node, state, path.scope);
      names.push(name);

      state.elements.forEach(definition => {
        const nodePaths: NodePath[] = [];
        const nodes = transformerMap[definition.type](definition as any, state);

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
  });

  fnPath.traverse({ VariableDeclaration: scanForDeepDependencies }, state);

  const componentElement = createComponentElement(
    returnValue,
    createUpdatableUpdater(
      variableStatementDependencyManager,
      fnPath.get("body")
    )
  );

  state.moduleDependencies.add("propUpdater");
  const returnPath = fnPath
    .get("body")
    .pushContainer("body", t.returnStatement(componentElement))[0];

  if (state.state && state.state.length > 0) {
    const [internalStateDeclaration, defineUpdater] = createStateDefinition(
      state.state,
      variableStatementDependencyManager,
      fnPath
    );

    fnPath.get("body").unshiftContainer("body", internalStateDeclaration);
    returnPath.insertBefore(defineUpdater);
  }

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
