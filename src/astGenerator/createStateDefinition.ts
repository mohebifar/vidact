import * as t from "@babel/types";
import { NodePath } from "@babel/core";

import VariableStatementDependencyManager from "../utils/VariableStatementDependencyManager";
import { createUpdatableUpdater } from "./createUpdatableUpdater";

import { STATE_VAR, KEY_STATE_UPDATER } from "../constants";
import { ComponentState } from "../plugin";

export interface InternalStateRecord {
  name: t.Identifier;
  originalName: string;
  initialValue?: t.Expression;
}

export function createStateDefinition(
  state: ComponentState,
  variableStatementDependencyManager: VariableStatementDependencyManager,
  fnPath: NodePath<t.FunctionDeclaration>
) {
  const states = state.state;
  const internalStateDeclaration = t.variableDeclaration("const", [
    t.variableDeclarator(
      t.identifier(STATE_VAR),
      t.objectExpression(
        states.map(({ name, initialValue }) =>
          t.objectProperty(name, initialValue || t.identifier("undefined"))
        )
      )
    )
  ]);

  const defineUpdater = t.variableDeclaration("const", [
    t.variableDeclarator(
      t.identifier(KEY_STATE_UPDATER),
      createUpdatableUpdater(
        variableStatementDependencyManager,
        fnPath.get("body"),
        state,
        "state"
      )
    )
  ]);

  return [internalStateDeclaration, defineUpdater];
}
