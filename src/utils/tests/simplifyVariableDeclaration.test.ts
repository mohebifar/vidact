import { tsquery } from "@phenomnomnominal/tsquery";
import {
  parseAndTypeCheckForTesting,
  printAstForTesting,
} from "../testingUtils";
import { simplifyVariableDeclaration } from "../simplifyVariableDeclaration";
import ts from "typescript";

function applyAndPrint(variableDeclarationList: ts.VariableDeclarationList) {
  const variableStatements = simplifyVariableDeclaration(
    variableDeclarationList
  ).map((list) => ts.factory.createVariableStatement(undefined, list));

  return printAstForTesting(variableStatements);
}

describe("simplifyVariableDeclaration", () => {
  test("returns true if the given statement is function declaration with JSX.Element return type", () => {
    const code = `const foo = bar();`;

    const [ast] = parseAndTypeCheckForTesting(code);
    const [node] = tsquery.query(ast, "VariableDeclarationList");

    const printedCode = applyAndPrint(node as ts.VariableDeclarationList);
    console.log(printedCode);
  });
});
