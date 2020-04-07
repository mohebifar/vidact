import { NodePath } from "@babel/core";
import * as t from "@babel/types";

import { ComponentState } from "../plugin";
import { normalizeUseEffect } from "./normalizeUseEffect";
import { normalizeUseMemo } from "./normalizeUseMemo";

export function scanHooks(
  functionPath: NodePath<t.FunctionDeclaration>,
  state: ComponentState
) {
  functionPath.get("body").traverse({
    enter(path) {
      if (path.isBlockStatement()) {
        return path.skip();
      }

      if (path.isCallExpression() && path.scope === functionPath.scope) {
        normalizeUseEffect(path, state);
        normalizeUseMemo(path, state);
      }
    },
  });
}
