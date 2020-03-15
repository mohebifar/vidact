import { NodePath } from "@babel/core";
import * as t from "@babel/types";

export function separateVariableDeclarations(fnPath: NodePath) {
  fnPath.traverse({
    VariableDeclaration(path) {
      const declarations = path.get("declarations");
      if (declarations.length < 2) {
        return;
      }

      path.replaceWithMultiple(
        declarations.map(declaration =>
          t.variableDeclaration(path.get("kind"), [declaration.node])
        )
      );
    }
  });
}
