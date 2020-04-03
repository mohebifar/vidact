import * as t from "@babel/types";
import generate from "@babel/generator";

import { getNodePathForType, parseJSX } from "../../__tests__/utils";
import { createStatementUpdater } from "../createStatementUpdater";

describe("createStatementUpdater", () => {
  it("wraps the given statement within an arrow function declaration and returns as the first value", () => {
    const ast = parseJSX("fakeCallExpressionStatement();");
    const [statementPath] = getNodePathForType(ast, "ExpressionStatement");

    const [updaterDeclarator] = createStatementUpdater(
      statementPath,
      statementPath.scope
    );
    expect(generate(updaterDeclarator).code).toStrictEqual(
      "const _executer = () => {\n  fakeCallExpressionStatement();\n};"
    );
  });

  it("returns a call expression for the updater function as the second value", () => {
    const ast = parseJSX("fakeCallExpressionStatement();");
    const [statementPath] = getNodePathForType(ast, "ExpressionStatement");

    const [, callExpression] = createStatementUpdater(
      statementPath,
      statementPath.scope
    );
    expect(generate(callExpression).code).toStrictEqual("_executer();");
  });

  it("returns the updater's identifier as the third value", () => {
    const ast = parseJSX("fakeCallExpressionStatement();");
    const [statementPath] = getNodePathForType(ast, "ExpressionStatement");

    const [, , id] = createStatementUpdater(statementPath, statementPath.scope);
    expect(id).toMatchObject(t.identifier("_executer"));
  });
});
