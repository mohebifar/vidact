import { NodePath } from "@babel/core";
import * as t from "@babel/types";

import { annotate } from "../utils/annotations";
import { USE_REF } from "../constants";

export function normalizeUseRef(functionPath: NodePath<t.FunctionDeclaration>) {
  function visitor(path: NodePath<t.VariableDeclaration>) {
    const [declarator] = path.get("declarations");
    const init = declarator.get("init");

    if (
      init.isCallExpression() &&
      t.isIdentifier(init.node.callee) &&
      init.node.callee.name === USE_REF
    ) {
      const [param] = init.get("arguments");

      const value =
        param && param.isExpression() ? param.node : t.identifier("undefined");

      init.replaceWith(
        t.objectExpression([t.objectProperty(t.identifier("current"), value)])
      );
      path.node.kind = "var";
      annotate(path, "locked");
    }
  }

  functionPath.traverse({
    VariableDeclaration: visitor,
  });
}
