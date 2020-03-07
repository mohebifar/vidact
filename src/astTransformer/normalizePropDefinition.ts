import { NodePath } from "@babel/core";
import * as t from "@babel/types";

import { PROP_VAR } from "../constants";

export function normalizePropDefinition(path: NodePath<t.FunctionDeclaration>) {
  const param = path.node.params[0];
  if (param.type === "ObjectPattern") {
    // param.properties.forEach(property => {
    //   if (property.type === "ObjectProperty") {
    //     const binding = path.scope.getBinding(property.key.name);
    //   } else if (property.type === "RestElement") {
    //     const binding = path.scope.getBinding(
    //       (property.argument as t.Identifier).name
    //     );
    //     binding.referencePaths.forEach(path => {
    //       console.log(path);
    //     });
    //   }
    // });
    // path.node.params[0] = t.identifier(PROP_VAR);
  } else if (param.type === "Identifier") {
    path.scope.rename(param.name, PROP_VAR);
  }
}
