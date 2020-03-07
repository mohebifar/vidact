import { NodePath } from "@babel/core";
import * as t from "@babel/types";

const componentNameRegex = /^[A-Z]/;

export function isComponent(path: NodePath<t.FunctionDeclaration>) {
  const functionName = path.get("id").node.name;
  return componentNameRegex.test(functionName);
}
