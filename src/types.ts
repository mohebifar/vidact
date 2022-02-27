import ts from "typescript";

export interface StateDescriptor {
  type: "state";
  id: number;
  name?: string;
  intialValue?: any;
}

export interface PropDescriptor {
  id: number;
  name: string;
  initialValue?: any;
}

export interface StatementDescriptor {
  type: "statement";
  statement: ts.Statement;
  dependencies: Dependency[];
}

export interface EffectDescriptor {
  type: "effect";
  dependencies: Dependency[];
  body: ts.FunctionBody;
}

export interface MemoDescriptor {
  type: "memo";
  dependencies: Dependency[];
  body: ts.FunctionBody;
}

export type Dependency =
  | {
      type: "prop" | "state";
      id: number;
    }
  | {
      type: "expression";
      expression: ts.Expression;
    };

export type ComponentStatement =
  | StatementDescriptor
  | StateDescriptor
  | EffectDescriptor
  | MemoDescriptor;

export interface ComponentDescriptor {
  name?: string;
  statements?: ComponentStatement[];
  props?: PropDescriptor[];
}
