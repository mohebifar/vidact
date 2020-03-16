import { NodePath } from "@babel/core";
import * as t from "@babel/types";

export function declarationToAssigment(path: NodePath<t.VariableDeclaration>) {
  const declarator = path.get("declarations")[0];
  const { id, init } = declarator.node;
  path.replaceWith(
    t.assignmentExpression("=", id, init || t.identifier("undefined"))
  );

  let ids: string[];
  if (t.isIdentifier(id)) {
    ids = [id.name];
  } else {
    declarator.get("id").traverse(
      {
        Identifier(idPath, state) {
          state.push(idPath.node.name);
        }
      },
      (ids = [])
    );
  }

  return ids;
}
