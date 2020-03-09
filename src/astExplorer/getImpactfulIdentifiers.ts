import * as t from "@babel/types";
import traverse, { Scope, NodePath } from "@babel/traverse";

import { DependencyType } from "../utils/VariableStatementDependencyManager";
import { PROP_VAR } from "../constants";

export function getImpactfulIdentifiers(
  node: t.Node,
  scope: Scope,
  parentPath: NodePath
) {
  const impactfulIdentifiers: [DependencyType, string][] = [];
  if (t.isIdentifier(node)) {
    impactfulIdentifiers.push(["local", node.name]);
  }

  traverse(
    node,
    {
      Identifier(p) {
        if (t.isMemberExpression(p.container)) {
          const parentNode = p.container as t.MemberExpression;
          if (t.isIdentifier(parentNode.object)) {
            if (p.node.name !== PROP_VAR) {
              if (parentNode.object.name === PROP_VAR) {
                impactfulIdentifiers.push(["prop", parentNode.property.name]);
              } else if (parentNode.object.name === p.node.name) {
                impactfulIdentifiers.push(["local", p.node.name]);
              }
            }
          }
        } else {
          impactfulIdentifiers.push(["local", p.node.name]);
        }
      }
    },
    scope,
    {},
    parentPath
  );

  return impactfulIdentifiers;
}
