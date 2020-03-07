import { SourceLocation } from "@babel/types";
import { NodePath } from "@babel/traverse";
import * as t from "@babel/types";

export type DependencyType = "node" | "local" | "prop";
export type DependencyDescriptor = {
  type: DependencyType;
  value: string;
  location?: SourceLocation["start"];
};

export default class VariableStatementDependencyManager {
  public variables = new Map<string, DependencyDescriptor[]>();
  public statements = new Map<string, NodePath>();
  private id = 0;

  public push(
    type: DependencyType,
    key: string,
    valueType: DependencyType,
    value: string | NodePath,
    location?: SourceLocation["start"]
  ) {
    const mapKey = `${type},${key}`;

    if (!this.variables.has(mapKey)) {
      this.variables.set(mapKey, []);
    }

    if (typeof value === "string") {
      this.variables.get(mapKey).push({
        value,
        type: valueType,
        location
      });
    } else {
      const key = this.getStatementKey(value.node);
      this.statements.set(key, value);
      this.variables.get(mapKey).push({
        value: key,
        type: valueType,
        ...(value.node.loc ? value.node.loc.start : {})
      });
    }
  }

  private getStatementKey(node: t.Node) {
    const { type, loc } = node;
    const { start, end } = loc || {
      start: { line: ++this.id, column: 0 },
      end: { line: this.id, column: 1 }
    };

    return `${type}-${start.line},${start.column},${end.line},${end.column}`;
  }
}
