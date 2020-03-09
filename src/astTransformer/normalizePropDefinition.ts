import { NodePath } from "@babel/core";
import * as t from "@babel/types";

import { PROP_VAR } from "../constants";

export function normalizePropDefinition(path: NodePath<t.FunctionDeclaration>) {
  const params = path.get("params");
  if (params.length === 0) {
    return;
  }

  const paramPath = params[0];
  if (paramPath.isObjectPattern()) {
    const nodeToPrepend = t.variableDeclaration("let", [
      t.variableDeclarator(paramPath.node, t.identifier(PROP_VAR))
    ]);
    paramPath.replaceWith(t.identifier(PROP_VAR));
    path.get("body").unshiftContainer("body", nodeToPrepend);
  } else if (paramPath.isIdentifier()) {
    path.scope.rename(paramPath.node.name, PROP_VAR);
  }
}
