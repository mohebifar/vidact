import { Visitor } from "@babel/core";
import template from "@babel/template";
import traverse, { Scope, NodePath } from "@babel/traverse";
import jsx from "@babel/plugin-syntax-jsx";
import * as t from "@babel/types";
import {
  ElementDefenition,
  transformerMap,
  createComponentElement
} from "./createDefinitions";

const PROP_VAR = "__internal_props";

type DependencyType = "node" | "local" | "prop";
type Location = {
  line: number;
  column: number;
};
type DependencyDescriptor = {
  type: DependencyType;
  value: string;
  location?: Location;
};

type VariablesMap = Map<string, DependencyDescriptor[]>;
type StatementsMap = Map<string, NodePath>;

function findImmediateStatement(s: NodePath) {
  return (
    s.parentPath.isBlockStatement() &&
    s.parentPath.parentPath.isFunctionDeclaration()
  );
}

let id = 0;
function getStatementKey(node: t.Node) {
  const { type, loc } = node;
  const { start, end } = loc || {
    start: { line: ++id, column: 0 },
    end: { line: id, column: 1 }
  };

  return `${type}-${start.line},${start.column},${end.line},${end.column}`;
}

function getStatementUpdaterIdentifier(path: NodePath<t.VariableDeclaration>) {
  const node = path.get("declarations")[0].get("id").node;
  if (node.type === "Identifier") {
    return node.name;
  }
  throw new Error("Statement updater declarator must be an Identifier");
}

function getImpactfulIdentifiers(
  node: t.Node,
  scope: Scope,
  parentPath: NodePath
) {
  const impactfulIdentifiers: [DependencyType, string][] = [];
  traverse(
    node,
    {
      Identifier(p) {
        if ((p.container as any).type === "MemberExpression") {
          const parentNode = p.container as t.MemberExpression;
          if (
            p.node.name !== PROP_VAR &&
            parentNode.object.type === "Identifier" &&
            parentNode.object.name === PROP_VAR
          ) {
            impactfulIdentifiers.push(["prop", parentNode.property.name]);
          }
        } else {
          impactfulIdentifiers.push(["local", p.node.name]);
        }
      }
    },
    scope,
    {},
    parentPath
  );

  console.log("impactfulIdentifiers", impactfulIdentifiers);

  return impactfulIdentifiers;
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
  if (element.type === "JSXText" && element.value.trim() === "") {
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

function createUpdateProps(variables: VariablesMap, statements: StatementsMap) {
  const statementNamesMap = new Map<string, string>();

  for (const [key, statement] of statements.entries()) {
    statementNamesMap.set(key, getStatementUpdaterIdentifier(statement as any));
  }
  const statementNamesSorted = [...statementNamesMap.values()];

  function getDependencies(
    dependencies: DependencyDescriptor[]
  ): DependencyDescriptor[] {
    return dependencies.flatMap(dependency => {
      if (dependency.type === "local") {
        const searchKey = `local,${dependency.value}`;
        return searchKey && getDependencies(variables.get(searchKey));
      } else {
        return dependency;
      }
    });
  }

  const executionCode = template.ast`
const statementsToExecute = new Set();
for (const prop in newProps) {
  if (propDependencyMap.has(prop) && __internal_props[prop] !== newProps[prop]) {
    __internal_props[prop] = newProps[prop];
    for (dependency of propDependencyMap.get(prop)) {
		  statementsToExecute.add(dependency)
    }
  }
}

const statementsToExecuteSorted = [...statementsToExecute].sort((a, b) => a > b ? 1 : -1).map(id => dependencies[id]);
statementsToExecuteSorted.forEach(statement => statement());
  `;

  return t.functionDeclaration(
    t.identifier("updateProps"),
    [t.identifier("newProps")],
    t.blockStatement(
      [
        t.variableDeclaration("const", [
          t.variableDeclarator(
            t.identifier("dependencies"),
            t.arrayExpression(
              [...statementNamesMap.values()].map(s => t.identifier(s))
            )
          ),
          t.variableDeclarator(
            t.identifier("propDependencyMap"),
            t.newExpression(t.identifier("Map"), [
              t.arrayExpression(
                [...variables.entries()]
                  .map(([a, b]): [string[], DependencyDescriptor[]] => [
                    a.split(","),
                    b
                  ])
                  .filter(([a]) => a[0] === "prop")
                  .map(([[, key], dependencies]) => {
                    return t.arrayExpression([
                      t.stringLiteral(key),
                      t.arrayExpression(
                        getDependencies(dependencies).map(dep =>
                          t.numericLiteral(
                            statementNamesSorted.indexOf(
                              statementNamesMap.get(dep.value)
                            )
                          )
                        )
                      )
                    ]);
                  })
              )
            ])
          )
        ])
      ].concat(executionCode as any)
    )
  );
}

export default function() {
  const visitor: Visitor<any> = {
    FunctionDeclaration(path) {
      const state = {
        elements: []
      };

      const param = path.node.params[0];
      if (param.type === "ObjectPattern") {
        // param.properties.forEach(property => {
        //   if (property.type === "ObjectProperty") {
        //     const binding = path.scope.getBinding(property.key.name);
        //   } else if (property.type === "RestElement") {
        //     const binding = path.scope.getBinding(
        //       (property.argument as t.Identifier).name
        //     );
        //     binding.referencePaths.forEach(path => {
        //       console.log(path);
        //     });
        //   }
        // });
        // path.node.params[0] = t.identifier(PROP_VAR);
      } else if (param.type === "Identifier") {
        path.scope.rename(param.name, PROP_VAR);
      }

      const variables = new Map<string, DependencyDescriptor[]>();
      const variablesWithDependencies = new Set<string>();
      const declarations = new Map<NodePath, t.Node>();
      const statements = new Map<string, NodePath>();

      function push(
        type: DependencyType,
        key: string,
        valueType: DependencyType,
        value: string | NodePath,
        location?: Location
      ) {
        const mapKey = `${type},${key}`;

        if (!variables.has(mapKey)) {
          variables.set(mapKey, []);
        }

        if (typeof value === "string") {
          variables.get(mapKey).push({
            value,
            type: valueType,
            location
          });
        } else {
          const key = getStatementKey(value.node);
          statements.set(key, value);
          variables.get(mapKey).push({
            value: key,
            type: valueType,
            ...(value.node.loc ? value.node.loc.start : {})
          });
        }
      }

      path.traverse({
        MemberExpression(objectReferencePath) {
          const { node } = objectReferencePath;
          const { object, property } = node;

          if (object.type === "Identifier" && object.name === PROP_VAR) {
            let statement = objectReferencePath.findParent(p =>
              p.isVariableDeclaration()
            ) as NodePath<t.VariableDeclaration>;
            if (!statement) {
              return;
            }

            // TODO: Check
            const id = statement.node.declarations[0].id;

            if (id.type === "Identifier") {
              push(
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
                push("local", id.name, "node", declaration);
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
                    push("local", id.name, "node", statement);
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

      for (const [statementKey, statementPath] of statements.entries()) {
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
                    push(type, key, "node", nodePath);
                  });
                }

                return nodes;
              })
              .forEach(node => {
                if (node) {
                  path.getStatementParent().insertBefore(node);
                }
              });
            const componentElement = createComponentElement(
              name,
              t.identifier("updateProps")
            );

            path.skip();
            path.replaceWith(componentElement);
          }
        },
        state
      );

      console.log(variables);
      path.get("body").node.body.push(createUpdateProps(variables, statements));
      path.skip();
    }
  };

  return {
    name: "carrot",
    inherits: jsx,
    visitor
  };
}
