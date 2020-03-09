import { NodePath } from "@babel/core";
import * as t from "@babel/types";

export function normalizeObjectPatternAssignment(
  functionPath: NodePath<t.FunctionDeclaration>
) {
  function visitor(
    path: NodePath<t.VariableDeclaration | t.AssignmentExpression>
  ) {
    let id: NodePath<t.LVal>;
    let init: NodePath<t.Expression>;
    if (path.isVariableDeclaration()) {
      const declarator = path.get("declarations")[0];
      id = declarator.get("id");
      init = declarator.get("init");
    } else if (path.isAssignmentExpression()) {
      id = path.get("left");
      init = path.get("right");
    }

    if (id.isObjectPattern()) {
      const replacements = id
        .get("properties")
        .map(property => {
          if (property.isObjectProperty()) {
            const key = t.cloneWithoutLoc(property.node.key);
            const newId = t.cloneWithoutLoc(property.node.value);
            const newInit = t.cloneWithoutLoc(
              t.memberExpression(init.node, key)
            );

            if (!t.isLVal(newId)) {
              return undefined;
            }

            if (path.isVariableDeclaration()) {
              return t.variableDeclaration(path.node.kind, [
                t.variableDeclarator(newId, newInit)
              ]);
            } else if (path.isAssignmentExpression()) {
              return t.assignmentExpression(path.node.operator, newId, newInit);
            }
          } else if (property.isRestElement()) {
            // TODO: Handle rest
            return undefined;
          }

          return undefined;
        })
        .filter(o => t.isNode(o));

      path.replaceWithMultiple(replacements).forEach(newPath => {
        let id: NodePath<t.Identifier>;
        if (newPath.isVariableDeclaration()) {
          id = newPath.get("declarations")[0].get("id") as NodePath<
            t.Identifier
          >;
        } else {
          id = (newPath as NodePath<t.AssignmentExpression>).get(
            "left"
          ) as NodePath<t.Identifier>;
        }

        const name = id.node.name;

        const { referencePaths } = path.scope.getOwnBinding(name);
        path.scope.removeOwnBinding(name);
        path.scope.registerBinding("let", newPath);
        path.scope.getOwnBinding(name).referencePaths = referencePaths;
      });
    }
  }

  functionPath.traverse({
    VariableDeclaration: visitor,
    AssignmentExpression: visitor
  });
}
