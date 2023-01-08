import ts from "typescript";
import { compareSymbolName } from "../../utils/compareSymbolName";

type IsComponentResult =
  | {
      isComponent: true;
      body: ts.ConciseBody;
      name?: string;
    }
  | {
      isComponent: false;
    };

const NOT_COMPONENT_RESULT: IsComponentResult = { isComponent: false };

/**
 * Evaluates an AST node to check whether it is a component or not
 *
 * @param node an AST node to check if it's a component or not
 * @param checker TS program type checker object
 * @returns an IsComponentResult object containing an isComponent boolean param as well as body (ConciseBody) and component name
 */
export function isComponent(
  node: ts.Node,
  checker: ts.TypeChecker
): IsComponentResult {
  let type: ts.Type | null = null;
  let functionBody: ts.ConciseBody | undefined = undefined;
  let functionName: string | undefined = undefined;

  if (ts.isFunctionDeclaration(node)) {
    type = checker.getTypeAtLocation(node);
    functionBody = node.body;
    functionName = node.name?.getText();
  } else if (ts.isVariableStatement(node)) {
    const [declaration] = node.declarationList.declarations;
    if (
      declaration.initializer &&
      ts.isArrowFunction(declaration.initializer)
    ) {
      functionName = declaration.name.getText();
      functionBody = declaration.initializer.body;
      type = checker.getTypeAtLocation(declaration.initializer);
    }

    if (declaration.type) {
      // Override the type if defined explicitly
      type = checker.getTypeFromTypeNode(declaration.type);
    }
  }

  if (!functionBody || !type) {
    return NOT_COMPONENT_RESULT;
  }

  if (
    compareSymbolName("React.FunctionComponent", type.symbol) ||
    compareSymbolName("React.FC", type.symbol) ||
    compareSymbolName("React.VFC", type.symbol)
  ) {
    return {
      isComponent: true,
      body: functionBody,
      name: functionName,
    };
  }

  // If not explicitly defined, check the return type.
  // Implicit JSX.Element or null return types are allowed and considered as component
  const signatureTypes = checker.getSignaturesOfType(
    type,
    ts.SignatureKind.Call
  );
  const returnTypes = signatureTypes.flatMap((signature) => {
    const returnType = signature.getReturnType();
    return returnType.isUnion() ? returnType.types : returnType;
  });

  const allReturnTypesConformToFC = returnTypes.every((returnType) => {
    // TODO: Not supporting solely returning `null`
    if (returnType.flags & ts.TypeFlags.Null) {
      return true;
    }

    if (returnType.flags & ts.TypeFlags.Object && returnType.symbol) {
      const isReturnTypeJsxElement = compareSymbolName(
        "JSX.Element",
        returnType.symbol
      );

      return isReturnTypeJsxElement;
    }

    return false;
  });

  if (allReturnTypesConformToFC) {
    return {
      isComponent: true,
      body: functionBody,
      name: functionName,
    };
  }

  return NOT_COMPONENT_RESULT;
}
