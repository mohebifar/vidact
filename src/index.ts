import * as ts from "typescript";
import { componentAstToDescriptor } from "./analyzers/component/componentAstToDescriptor";
import { isComponent } from "./analyzers/component/isComponent";

export default function transformer(
  program: ts.Program
): ts.TransformerFactory<ts.SourceFile> {
  return (context: ts.TransformationContext) => (file: ts.SourceFile) =>
    visitNodeAndChildren(file, program, context);
}

function visitNodeAndChildren(
  node: ts.SourceFile,
  program: ts.Program,
  context: ts.TransformationContext
): ts.SourceFile;
function visitNodeAndChildren(
  node: ts.Node,
  program: ts.Program,
  context: ts.TransformationContext
): ts.Node | undefined;
function visitNodeAndChildren(
  node: ts.Node,
  program: ts.Program,
  context: ts.TransformationContext
): ts.Node | undefined {
  return ts.visitEachChild(
    visitNode(node, program, context),
    (childNode) => visitNodeAndChildren(childNode, program, context),
    context
  );
}

function visitNode(
  node: ts.SourceFile,
  program: ts.Program,
  context: ts.TransformationContext
): ts.SourceFile;
function visitNode(
  node: ts.Node,
  program: ts.Program,
  context: ts.TransformationContext
): ts.Node | undefined;
function visitNode(
  node: ts.Node,
  program: ts.Program,
  context: ts.TransformationContext
): ts.Node | undefined {
  const typeChecker = program.getTypeChecker();
  const componentCheckResult = isComponent(node, typeChecker);
  if (componentCheckResult.isComponent && componentCheckResult.body) {
    componentAstToDescriptor(componentCheckResult.body, typeChecker, context);
    console.log("test", node.getText());
  }

  return node;
}
