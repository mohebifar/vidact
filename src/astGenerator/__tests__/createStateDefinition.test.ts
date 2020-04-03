import * as t from "@babel/types";
import generate from "@babel/generator";

import { getNodePathForType, parseJSX } from "../../__tests__/utils";
import { createStateDefinition } from "../createStateDefinition";
import { ComponentState } from "../../plugin";
import VariableStatementDependencyManager from "../../utils/VariableStatementDependencyManager";

describe("createStateDefinition", () => {
  it("creates state declarator from state definition array", () => {
    const state = makeState({
      state: [
        {
          name: t.identifier("myState"),
          originalName: "myState"
        }
      ]
    });
    const ast = parseJSX("function MyComponent() {}");
    const [fnPath] = getNodePathForType(ast, "FunctionDeclaration");

    const [stateDeclarator] = createStateDefinition(state, fnPath);
    expect(generate(stateDeclarator).code).toStrictEqual(
      "const __internal_state = {\n  myState: undefined\n};"
    );
  });

  it("creates state declarator from state definition array and uses initial value", () => {
    const state = makeState({
      state: [
        {
          name: t.identifier("myState"),
          originalName: "myState",
          initialValue: t.binaryExpression(
            "+",
            t.numericLiteral(2),
            t.numericLiteral(10)
          )
        }
      ]
    });
    const ast = parseJSX("function MyComponent() {}");
    const [fnPath] = getNodePathForType(ast, "FunctionDeclaration");

    const [stateDeclarator] = createStateDefinition(state, fnPath);
    expect(generate(stateDeclarator).code).toStrictEqual(
      "const __internal_state = {\n  myState: 2 + 10\n};"
    );
  });

  it("returns a stateUpdater function using propUpdater", () => {
    const state = makeState();
    const ast = parseJSX("function MyComponent() {}");
    const [fnPath] = getNodePathForType(ast, "FunctionDeclaration");

    const [, stateUpdater] = createStateDefinition(state, fnPath);
    expect(generate(stateUpdater).code).toStrictEqual(
      "const updateState = propUpdater(__internal_state, [], [], false);"
    );
  });
});

function makeState(state: Partial<ComponentState> = {}): ComponentState {
  return {
    variablesWithDependencies: new Set(),
    needsPropTransaction: false,
    looseAssignments: new Set(),
    state: [],
    variableStatementDependencyManager: new VariableStatementDependencyManager(),
    moduleDependencies: new Set(),
    ...state
  };
}
