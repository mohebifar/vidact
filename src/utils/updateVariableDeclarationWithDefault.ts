import * as ts from "typescript";

// It returns a variable declaration like `const b = typeof x === 'undefined' ? default : x`
export function updateVariableDeclarationWithDefault(
  declaration: ts.VariableDeclaration,
  defaultInitializer: ts.Expression
) {
  if (ts.isIdentifier(declaration.name)) {
    let identifier: ts.Identifier;
    let separatedDeclarationForExpression: ts.VariableDeclaration | null = null;
    if (declaration.initializer && ts.isIdentifier(declaration.initializer)) {
      identifier = declaration.initializer;
    } else {
      identifier = ts.factory.createUniqueName("__vdValueWithDefault");
      separatedDeclarationForExpression = ts.factory.createVariableDeclaration(
        identifier,
        undefined,
        undefined,
        declaration.initializer
      );
    }

    const updatedDeclaration = ts.factory.updateVariableDeclaration(
      declaration,
      declaration.name,
      undefined,
      undefined,
      ts.factory.createConditionalExpression(
        ts.factory.createBinaryExpression(
          ts.factory.createTypeOfExpression(identifier),
          ts.SyntaxKind.EqualsEqualsEqualsToken,
          ts.factory.createStringLiteral("undefined")
        ),
        undefined,
        defaultInitializer,
        undefined,
        identifier
      )
    );

    return separatedDeclarationForExpression
      ? [separatedDeclarationForExpression, updatedDeclaration]
      : [updatedDeclaration];
  }
}
