import ts from "typescript";

export interface DependentFunctionArgDescriptor {
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
      type: "arg" | "var";
      id: number;
    }
  | {
      type: "expression";
      expression: ts.Expression;
    };

export type DependentFunctionStatement =
  | StatementDescriptor
  | EffectDescriptor
  | MemoDescriptor;

export interface DependentFunctionDescriptor {
  name?: string;
  statements?: DependentFunctionStatement[];
  args?: DependentFunctionArgDescriptor[];
}
