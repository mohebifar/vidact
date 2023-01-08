import { tsquery } from "@phenomnomnominal/tsquery";
import { parseAndTypeCheckForTesting } from "../../../utils/testingUtils";
import { isStateDefinition } from "../isStateDefinition";

describe("isStateDefinition", () => {
  test("returns true if the given statement is variable declaration with named import useState call expression initializer", () => {
    const code = `import { useState } from 'react';
  function Component() {
      const [state, setState] = useState(2);
  }`;

    const [ast, typeChecker] = parseAndTypeCheckForTesting(code);
    const [node] = tsquery.query(ast, "VariableStatement");

    expect(isStateDefinition(node, typeChecker)).toStrictEqual(true);
  });

  test("returns true if the given statement is variable declaration with namespace import React.useState call expression initializer", () => {
    const code = `import * as React from 'react';
  function Component() {
      const [state, setState] = React.useState(2);
  }`;

    const [ast, typeChecker] = parseAndTypeCheckForTesting(code);
    const [node] = tsquery.query(ast, "VariableStatement");

    expect(isStateDefinition(node, typeChecker)).toStrictEqual(true);
  });

  test("returns false if the given statement is variable declaration with call expression initializer of a callback named useState but not the same as React.useState", () => {
    const code = `
  function Component() {
      const [state, setState] = useState(2);
  }`;

    const [ast, typeChecker] = parseAndTypeCheckForTesting(code);
    const [node] = tsquery.query(ast, "VariableStatement");

    expect(isStateDefinition(node, typeChecker)).toStrictEqual(false);
  });

  test("returns false if the given statement is not variable declaration", () => {
    const code = `console.log('Hello');`;
    const [ast, typeChecker] = parseAndTypeCheckForTesting(code);
    const [node] = tsquery.query(ast, "ExpressionStatement");

    expect(isStateDefinition(node, typeChecker)).toStrictEqual(false);
  });

  test("returns false if the given statement is variable declaration but the initializer is not call expression", () => {
    const code = `const [state, setState] = 2;`;

    const [ast, typeChecker] = parseAndTypeCheckForTesting(code);
    const [node] = tsquery.query(ast, "VariableStatement");

    expect(isStateDefinition(node, typeChecker)).toStrictEqual(false);
  });
});
