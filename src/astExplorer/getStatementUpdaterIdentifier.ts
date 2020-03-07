import { NodePath } from "@babel/core";
import * as t from "@babel/types";

export default function getStatementUpdaterIdentifier(path: NodePath<t.VariableDeclaration>) {
  const node = path.get("declarations")[0].get("id").node;
  if (node.type === "Identifier") {
    return node.name;
  }
  throw new Error("Statement updater declarator must be an Identifier");
}
