import ts from "typescript";
import { checkSymbolName } from "./checkSymbolName";

export function isComponent(checker: ts.TypeChecker, node: ts.Node) {
  let type: ts.Type | undefined = undefined;
  if (ts.isFunctionDeclaration(node)) {
    type = checker.getTypeAtLocation(node);
  } else if (ts.isVariableStatement(node)) {
    const [declaration] = node.declarationList.declarations;
    if (declaration.type) {
      type = checker.getTypeFromTypeNode(declaration.type);
    } else if (
      declaration.initializer &&
      ts.isArrowFunction(declaration.initializer)
    ) {
      type = checker.getTypeAtLocation(declaration.initializer);
    }
  }

  if (!type) {
    return false;
  }

  if (checkSymbolName("React.FunctionComponent", type.symbol)) {
    return true;
  }

  const signatureTypes = checker.getSignaturesOfType(
    type,
    ts.SignatureKind.Call
  );

  const returnTypes = signatureTypes.flatMap((signature) => {
    const returnType = signature.getReturnType();
    return returnType.isUnion() ? returnType.types : returnType;
  });

  return returnTypes.every((returnType) => {
    if (returnType.flags & ts.TypeFlags.Null) {
      return true;
    }

    if (returnType.flags & ts.TypeFlags.Object && returnType.symbol) {
      const isReturnTypeJsxElement = checkSymbolName(
        "JSX.Element",
        returnType.symbol
      );

      return isReturnTypeJsxElement;
    }

    return false;
  });
}
