import * as ts from "typescript";
import { safeCreateUniqueName } from "./safeCreateUniqueName";
import { unfoldBindingName } from "./unfoldBindingName";
import { updateVariableDeclarationWithDefault } from "./updateVariableDeclarationWithDefault";

export function simplifyVariableDeclaration(
  declarationList: ts.VariableDeclarationList
) {
  return declarationList.declarations
    .flatMap((declaration) => {
      let initializer: ts.Identifier;
      let extraDeclaration: ts.VariableDeclaration | null = null;
      if (declaration.initializer && ts.isIdentifier(declaration.initializer)) {
        initializer = declaration.initializer;
      } else {
        initializer = safeCreateUniqueName("__vdCustomExpression");
        extraDeclaration = ts.factory.createVariableDeclaration(
          initializer,
          undefined,
          undefined,
          declaration.initializer
        );
      }

      const unfolded = unfoldBindingName(declaration.name, initializer);

      return [
        extraDeclaration,
        ...unfolded.flatMap((element) => {
          const newDeclaration = ts.factory.createVariableDeclaration(
            element.identifier,
            undefined,
            undefined,
            element.path
          );

          if (element.defaultInitializer) {
            return updateVariableDeclarationWithDefault(
              newDeclaration,
              element.defaultInitializer
            );
          }
          return newDeclaration;
        }),
      ].filter(Boolean);
    })
    .filter((declaration): declaration is ts.VariableDeclaration =>
      Boolean(declaration)
    )
    .map((declaration) =>
      ts.factory.createVariableDeclarationList([declaration])
    );
}
