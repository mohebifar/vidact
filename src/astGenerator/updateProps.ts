import * as t from "@babel/types";
import template from "@babel/template";

import VariableStatementDependencyManager, {
  DependencyDescriptor
} from "../utils/VariableStatementDependencyManager";
import getStatementUpdaterIdentifier from "../astExplorer/getStatementUpdaterIdentifier";
import { KEY_PROP_UPDATE } from "../constants";

const updatePropDependencyExecutionCode = template.ast`
const statementsToExecute = new Set();
for (const prop in newProps) {
  if (propDependencyMap.has(prop) && __internal_props[prop] !== newProps[prop]) {
    __internal_props[prop] = newProps[prop];
    for (const dependency of propDependencyMap.get(prop)) {
		  statementsToExecute.add(dependency)
    }
  }
}

const statementsToExecuteSorted = [...statementsToExecute].sort((a, b) => a > b ? 1 : -1).forEach(id => dependencies[id]());
`;

export function createUpdateProps(
  variableStatementDependencyManager: VariableStatementDependencyManager
) {
  const statementNamesMap = new Map<string, string>();
  const { statements, variables } = variableStatementDependencyManager;

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

  return t.functionDeclaration(
    t.identifier(KEY_PROP_UPDATE),
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
      ].concat(updatePropDependencyExecutionCode as any)
    )
  );
}
