import * as t from "@babel/types";
import generate from "@babel/generator";

import { getNodePathForType, parseJSX } from "../../__tests__/utils";
import { declarationToAssignment } from "../declarationToAssignment";

describe("declarationToAssignment", () => {
  it("returns declared variable names and replaces node with equivalent assignment", () => {
    const ast = parseJSX(`const myVar = 2;`);
    const [declaration] = getNodePathForType(ast, "VariableDeclaration");

    const [id] = declarationToAssignment(declaration);

    expect(id).toStrictEqual("myVar");
    expect(declaration.node).toMatchObject(
      t.expressionStatement(
        t.assignmentExpression("=", t.identifier(id), t.numericLiteral(2))
      )
    );
  });

  it("returns declared variable names and replaces node with assignment expression assigning undefined if variable declarator has no initial value", () => {
    const ast = parseJSX(`let myVar;`);
    const [declaration] = getNodePathForType(ast, "VariableDeclaration");

    const [id] = declarationToAssignment(declaration);

    expect(id).toStrictEqual("myVar");
    expect(declaration.node).toMatchObject(
      t.expressionStatement(
        t.assignmentExpression("=", t.identifier(id), t.identifier("undefined"))
      )
    );
  });

  it("returns a list of identifier names when assignee is array pattern", () => {
    const ast = parseJSX(`const [a, b] = [1, 2];`);
    const [declaration] = getNodePathForType(ast, "VariableDeclaration");

    const ids = declarationToAssignment(declaration);

    expect(ids).toEqual(["a", "b"]);
    expect(generate(declaration.node).code).toStrictEqual("[a, b] = [1, 2];");
  });

  it("returns a list of identifier names when assignee is object pattern", () => {
    const ast = parseJSX(`const {a, b} = props;`);
    const [declaration] = getNodePathForType(ast, "VariableDeclaration");

    const ids = declarationToAssignment(declaration);

    expect(ids).toEqual(["a", "b"]);
    expect(generate(declaration.node).code).toStrictEqual(
      "({\n  a,\n  b\n} = props);"
    );
  });
});
