import ts from "typescript";
import { compareSymbolName } from "../../utils/compareSymbolName";
import { isHookCall } from "../../utils/isHookCall";

export function isStateDefinition(node: ts.Node, checker: ts.TypeChecker) {
  if (ts.isVariableStatement(node)) {
    const [{ initializer }] = node.declarationList.declarations;

    if (initializer && isHookCall(initializer)) {
      const calleeType = checker.getTypeAtLocation(initializer.expression);
      const calleeSymbol = calleeType.getSymbol();
      return compareSymbolName("React.useState", calleeSymbol);
    }
  }

  return false;
}
