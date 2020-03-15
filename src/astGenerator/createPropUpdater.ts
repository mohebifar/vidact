import * as t from "@babel/types";
import { NodePath } from "@babel/core";

import VariableStatementDependencyManager, {
  DependencyDescriptor
} from "../utils/VariableStatementDependencyManager";
import getStatementUpdaterIdentifier from "../astExplorer/getStatementUpdaterIdentifier";
import { PROP_VAR } from "../constants";

export function createPropUpdater(
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
      if (o.isExpressionStatement() && o.get("expression").isCallExpression()) {
        const callee = o.get("expression").get("callee") as NodePath<
          t.Expression
        >;
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

  const getUniqDependencyNames = (dependencies: DependencyDescriptor[]) =>
    Array.from(
      new Set(
        getDependencies(dependencies).map(dep =>
          statementNamesMap.get(dep.value)
        )
      )
    );

  const getDependencyIds = (
    dependencies: DependencyDescriptor[],
    statementNamesSorted: string[]
  ) =>
    getUniqDependencyNames(dependencies)
      .map(name => statementNamesSorted.indexOf(name))
      .map(value => {
        const node = t.numericLiteral(value);
        t.addComment(node, "trailing", statementNamesSorted[value], false);
        return node;
      });

  const propDependencies = [...variables.entries()]
    .map(([a, b]): [string[], DependencyDescriptor[]] => [a.split(","), b])
    .filter(([a]) => a[0] === "prop");

  const usedStatementNames = propDependencies.flatMap(([, dependencies]) =>
    getUniqDependencyNames(dependencies)
  );

  const usedStatementNamesSorted = statementNamesSorted.filter(name =>
    usedStatementNames.includes(name)
  );

  const dependencies = t.arrayExpression(
    usedStatementNamesSorted.map(name => t.identifier(name))
  );

  const propDependenciesMap = t.arrayExpression(
    propDependencies.map(([[, key], dependencies]) => {
      return t.arrayExpression([
        t.stringLiteral(key),
        t.arrayExpression(
          getDependencyIds(dependencies, usedStatementNamesSorted)
        )
      ]);
    })
  );

  return t.callExpression(t.identifier("propUpdater"), [
    t.identifier(PROP_VAR),
    dependencies,
    propDependenciesMap
  ]);
}
