import * as ts from "typescript";
import { ComponentDescriptor, ComponentStatement } from "./types";
import { createExecutorStatements } from "./utils/createExecutorStatements";
import { simplifyVariableDeclaration } from "./utils/simplifyVariableDeclaration";
import { unfoldBindingName } from "./utils/unfoldBindingName";

function createComponentAst(descriptor: ComponentDescriptor) {}

function findDependantStatements(block: ts.Block) {}

function componentAstToDescriptor(
  ast: ts.ArrowFunction | ts.FunctionDeclaration
) {
  const blocks: ComponentStatement[] = [];
  ast.body.forEachChild((node) => {
    if (ts.isVariableStatement(node)) {
      console.log(node.declarationList.declarations[0]!.type, '< TYPE')
    }
    
    
  });
}

var b = ts.createSourceFile(
  "test.tsx",
  `
  import * as React from 'react';
  const {a = 32, b: {c: [aa, , d]}} = {...test};
  const MyComponent = () => {
    const a : Aasd = 2;
    React.useEffect(() => {
      console.log('hello')
    }, [])
  }`,
  ts.ScriptTarget.ES2015
);

var input = (b.statements[1] as any).declarationList;
var functionInput = (b.statements[2] as any).declarationList.declarations[0]
  .initializer;
// var res = simplifyVariableDeclaration(input);

const testResultForDetection = componentAstToDescriptor(functionInput);
const exectuorTest = createExecutorStatements({
  dependencies: [{ type: "prop", id: 1 }],
  statement: b.statements[1],
  type: "statement",
});
var src = ts.factory.createSourceFile(
  exectuorTest.statements,
  ts.factory.createToken(ts.SyntaxKind.EndOfFileToken),
  ts.NodeFlags.None
);

(src as any).identifiers = new Set();

console.log(ts.createPrinter().printFile(src));
