import ts from "typescript";
import { getSyntaxKindName } from "../../utils/dubggingUtils";
import { isStateDefinition } from "./isStateDefinition";

export function componentAstToDescriptor(
  node: ts.ConciseBody,
  checker: ts.TypeChecker,
  _context: ts.TransformationContext
) {
  ts.forEachChild(node, (child) => {
    const isStateResult = isStateDefinition(child, checker);
    console.log(
      isStateResult,
      child.getText(),
      getSyntaxKindName(node.kind),
      "< child"
    );
  });
}
