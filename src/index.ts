import React from "react";
import * as ts from "typescript";
import { isComponent } from "./utils/isComponent";

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
    visitNode(node, program),
    (childNode) => visitNodeAndChildren(childNode, program, context),
    context
  );
}

function visitNode(node: ts.SourceFile, program: ts.Program): ts.SourceFile;
function visitNode(node: ts.Node, program: ts.Program): ts.Node | undefined;
function visitNode(node: ts.Node, program: ts.Program): ts.Node | undefined {
  const typeChecker = program.getTypeChecker();

  if (isComponent(typeChecker, node)) {
    console.log("test", node.getText());
  }

  if (ts.isVariableDeclaration(node)) {
    // newType = typeChecker.getTypeAtLocation(node);
    // console.log("newType <<<", newType);
  }

  if (ts.isFunctionDeclaration(node)) {
    let test = typeChecker.getTypeAtLocation(node);
    // test = (typeChecker as any).isTypeAssignableTo(test, newType);

    // let newType = typeChecker.getDeclaredTypeOfSymbol(symbol);
    // console.log(newType);
    // console.log(test);

    // console.log(test);
    return ts.factory.createExpressionStatement(
      ts.factory.createCallExpression(ts.factory.createUniqueName("hi"), [], [])
    );
  }

  return node;
}
