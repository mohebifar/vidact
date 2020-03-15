import { NodePath } from "@babel/core";
import * as t from "@babel/types";
import { ComponentState } from "../plugin";
import { isStatementExecuter, isElementUpdate } from "../utils/variableNames";

export function scanForDeepDependencies(
  path: NodePath<t.VariableDeclaration>,
  state: ComponentState
) {
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
        scanForDeepDependencies(innerPath, state);
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
      t.identifier(getUpdaterArrayName(name))
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
                  t.callExpression(t.identifier("consolidateExecuters"), [name])
                )
              ])
            )
          ])
        ),
        []
      )
    );
  }

  function addExportedUpdater(name: string, parent: NodePath) {
    const updaterName = getUpdaterArrayName(name);
    const updaterId = t.identifier(updaterName);

    parent.insertAfter(
      t.expressionStatement(
        t.callExpression(t.memberExpression(updaterId, t.identifier("push")), [
          t.identifier(name)
        ])
      )
    );

    exportedUpdaters.push(updaterId);
  }
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

function isUpdater(path: NodePath<t.VariableDeclaration>) {
  const { id } = path.node.declarations[0];

  return t.isIdentifier(id) &&
    (isStatementExecuter(id.name) || isElementUpdate(id.name))
    ? id
    : undefined;
}

function getUpdaterArrayName(name: string) {
  return name + "_all";
}
