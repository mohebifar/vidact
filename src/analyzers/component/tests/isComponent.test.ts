import { tsquery } from "@phenomnomnominal/tsquery";
import { parseAndTypeCheckForTesting } from "../../../utils/testingUtils";
import { isComponent } from "../isComponent";

describe("isComponent", () => {
  describe("function declaration variation", () => {
    test("returns true if the given statement is function declaration with JSX.Element return type", () => {
      const code = `import * as React from 'react';
      
      function MyComponent() {
        return <div>Hello</div>;
      };`;

      const [ast, typeChecker] = parseAndTypeCheckForTesting(code);
      const [node] = tsquery.query(ast, "FunctionDeclaration");

      const result = isComponent(node, typeChecker);
      expect(result.isComponent).toStrictEqual(true);
    });

    test("returns true if the given statement is function declaration with JSX.Element or null return type", () => {
      const code = `import * as React from 'react';
      
      function MyComponent() {
        if (cond) {
          return null;
        }
        return <div>Hello</div>;
      };`;

      const [ast, typeChecker] = parseAndTypeCheckForTesting(code);
      const [node] = tsquery.query(ast, "FunctionDeclaration");

      const result = isComponent(node, typeChecker);
      expect(result.isComponent).toStrictEqual(true);
    });

    test("returns false if the given statement is function declaration with JSX.Element or object return type", () => {
      const code = `import * as React from 'react';
      
      function MyComponent() {
        if (cond) {
          return {a: 2};
        }
        return <div>Hello</div>;
      };`;

      const [ast, typeChecker] = parseAndTypeCheckForTesting(code);
      const [node] = tsquery.query(ast, "FunctionDeclaration");

      const result = isComponent(node, typeChecker);
      expect(result.isComponent).toStrictEqual(false);
    });
  });

  describe("arrow function variation", () => {
    test("returns true if the type is explicitly React.FunctionComponent", () => {
      const code = `import * as React from 'react';
      
      const MyComponent: React.FunctionComponent<{}> = () => {};`;

      const [ast, typeChecker] = parseAndTypeCheckForTesting(code);
      const [node] = tsquery.query(ast, "VariableStatement");

      const result = isComponent(node, typeChecker);
      expect(result.isComponent).toStrictEqual(true);
    });

    test("returns true if the given node is arrow function declaration statement with JSX.Element return type", () => {
      const code = `import * as React from 'react';
      
      const MyComponent = () => {
        return <div>Hello</div>;
      };`;

      const [ast, typeChecker] = parseAndTypeCheckForTesting(code);
      const [node] = tsquery.query(ast, "VariableStatement");

      const result = isComponent(node, typeChecker);
      expect(result.isComponent).toStrictEqual(true);
    });

    test("returns true if the given node is arrow function declaration statement with JSX.Element or null return type", () => {
      const code = `import * as React from 'react';
      
      const MyComponent = () => {
        if (cond) {
          return null;
        }
        return <div>Hello</div>;
      };`;

      const [ast, typeChecker] = parseAndTypeCheckForTesting(code);
      const [node] = tsquery.query(ast, "VariableStatement");

      const result = isComponent(node, typeChecker);
      expect(result.isComponent).toStrictEqual(true);
    });

    test("returns false if the given node is arrow function declaration statement with JSX.Element or object return type", () => {
      const code = `import * as React from 'react';
      
      const MyComponent = () => {
        if (cond) {
          return {a: 2};
        }
        return <div>Hello</div>;
      };`;

      const [ast, typeChecker] = parseAndTypeCheckForTesting(code);
      const [node] = tsquery.query(ast, "VariableStatement");

      const result = isComponent(node, typeChecker);
      expect(result.isComponent).toStrictEqual(false);
    });
  });
});
