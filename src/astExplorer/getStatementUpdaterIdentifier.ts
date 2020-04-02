import { NodePath } from "@babel/core";
import * as t from "@babel/types";

export default function getStatementUpdaterIdentifier(
  path: NodePath<t.VariableDeclaration>
): string {
  const { node: id } = path.get("declarations")[0].get("id");
  if (t.isIdentifier(id)) {
    return id.name;
  }
  if (t.isArrayPattern(id) && t.isIdentifier(id.elements[0])) {
    return id.elements[0].name;
  }
  throw new Error(
    "Statement updater declarator must be an Identifier or ArrayPattern"
  );
}
