import * as ts from "typescript";

type UnfoldedBindingPattern = {
  identifier: ts.Identifier;
  path?: ts.Expression;
  defaultInitializer?: any;
};

function getPropertyName(
  propName?: ts.PropertyName
): ts.Identifier | ts.StringLiteral | ts.NumericLiteral {
  if (!propName) {
    throw new Error("Unkown error 1");
  }
  if (ts.isIdentifier(propName)) {
    return ts.factory.createStringLiteral(propName.text);
  }
  if (ts.isStringLiteral(propName) || ts.isNumericLiteral(propName)) {
    return propName;
  }
  throw new Error("Unknown error 2");
}

export function unfoldBindingName(
  pattern: ts.BindingName,
  parent: ts.ElementAccessExpression | ts.Identifier
): UnfoldedBindingPattern[] {
  if (ts.isIdentifier(pattern)) {
    return [
      {
        identifier: pattern,
      },
    ];
  }
  return pattern.elements
    .flatMap(
      (element: ts.BindingElement | ts.ArrayBindingElement, index: number) => {
        if (element.kind === ts.SyntaxKind.OmittedExpression) {
          return null;
        }
        const { name, propertyName, initializer } = element;
        let memberName: ts.Expression | number;
        if (propertyName) {
          memberName = ts.isIdentifier(name)
            ? ts.factory.createStringLiteral(name.text)
            : getPropertyName(propertyName);
        } else {
          memberName = ts.factory.createNumericLiteral(index);
        }

        const path = ts.factory.createElementAccessExpression(
          parent,
          memberName
        );

        if (ts.isIdentifier(name)) {
          return {
            identifier: name,
            path,
            defaultInitializer: initializer,
          };
        } else if (
          ts.isObjectBindingPattern(name) ||
          ts.isArrayBindingPattern(name)
        ) {
          return unfoldBindingName(name, path as any);
        }
        return null;
      }
    )
    .filter((t: UnfoldedBindingPattern | null): t is UnfoldedBindingPattern =>
      Boolean(t)
    );
}