import * as t from "@babel/types";
import template from "@babel/template";
import { NodePath } from "@babel/core";

import VariableStatementDependencyManager, {
  DependencyDescriptor
} from "../utils/VariableStatementDependencyManager";
import getStatementUpdaterIdentifier from "../astExplorer/getStatementUpdaterIdentifier";
import { KEY_PROP_UPDATE, PROP_VAR } from "../constants";

const NEW_PROPS_VAR = "newProps";
const PROP_DEPENDENCY_MAP_VAR = "propDependencyMap";
const DEPENDENCIES_VAR = "dependencies";

const updatePropDependencyExecutionCode = template.ast`
const dependenciesToExecute = new Set();
for (const prop in ${NEW_PROPS_VAR}) {
  if (${PROP_DEPENDENCY_MAP_VAR}.has(prop) && ${PROP_VAR}[prop] !== ${NEW_PROPS_VAR}[prop]) {
    ${PROP_VAR}[prop] = ${NEW_PROPS_VAR}[prop];
    for (const dependency of ${PROP_DEPENDENCY_MAP_VAR}.get(prop)) {
		  dependenciesToExecute.add(dependency)
    }
  }
}

const statementsToExecuteSorted = Array.from(dependenciesToExecute)
  .sort()
  .forEach(id => ${DEPENDENCIES_VAR}[id]());
`;

export function createUpdateProps(
  variableStatementDependencyManager: VariableStatementDependencyManager,
  path: NodePath<t.BlockStatement>
) {
  const statementNamesMap = new Map<string, string>();
  const { statements, variables } = variableStatementDependencyManager;

  for (const [key, statement] of statements.entries()) {
    statementNamesMap.set(key, getStatementUpdaterIdentifier(statement as any));
  }
  const statementNamesSorted = [...statementNamesMap.values()].sort((a, b) => {
    const findCallee = (name: string) => (o: NodePath) => {
      if (o.isCallExpression()) {
        const callee = o.get("callee") as NodePath<t.Expression>;
        if (callee.isIdentifier() && callee.node.name === name) {
          return true;
        }
      }
      return false;
    };
    const indexA = path.get("body").findIndex(findCallee(a));
    const indexB = path.get("body").findIndex(findCallee(b));
    return indexA > indexB ? 1 : -1;
  });

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

  const getDependencyIds = (dependencies: DependencyDescriptor[]) =>
    Array.from(
      new Set(
        getDependencies(dependencies).map(dep =>
          statementNamesSorted.indexOf(statementNamesMap.get(dep.value))
        )
      )
    ).map(value => {
      const node = t.numericLiteral(value);
      t.addComment(node, "trailing", statementNamesSorted[value], false);
      return node;
    });

  return t.functionDeclaration(
    t.identifier(KEY_PROP_UPDATE),
    [t.identifier(NEW_PROPS_VAR)],
    t.blockStatement(
      [
        t.variableDeclaration("const", [
          t.variableDeclarator(
            t.identifier(DEPENDENCIES_VAR),
            t.arrayExpression(statementNamesSorted.map(s => t.identifier(s)))
          ),
          t.variableDeclarator(
            t.identifier(PROP_DEPENDENCY_MAP_VAR),
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
                      t.arrayExpression(getDependencyIds(dependencies))
                    ]);
                  })
              )
            ])
          )
        ])
      ].concat(updatePropDependencyExecutionCode as any)
    )
  );
}
