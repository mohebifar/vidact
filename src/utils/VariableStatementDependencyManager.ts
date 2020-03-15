import { SourceLocation } from "@babel/types";
import { NodePath } from "@babel/traverse";
import * as t from "@babel/types";

export type DependencyType = "node" | "local" | "prop";
export type DependencyDescriptor = {
  type: DependencyType;
  value: string;
  location?: SourceLocation["start"];
};
export type VariableDescriptor = {
  type: "local" | "prop";
  name: string;
};
export type StatementDescriptor = {
  type: "node";
  value: NodePath;
};

export default class VariableStatementDependencyManager {
  public variables = new Map<string, DependencyDescriptor[]>();
  public statements = new Map<string, NodePath>();
  public nodeHashMap = new Map<t.Node, string>();

  private id = 0;

  public push(
    from: VariableDescriptor,
    to: VariableDescriptor | StatementDescriptor,
    location?: SourceLocation["start"]
  ) {
    const mapKey = `${from.type},${from.name}`;

    if (!this.variables.has(mapKey)) {
      this.variables.set(mapKey, []);
    }

    if ("name" in to) {
      this.variables.get(mapKey).push({
        value: to.name,
        type: to.type,
        location
      });
    } else {
      const key = this.getStatementKey(to.value.node);
      this.statements.set(key, to.value);
      this.variables.get(mapKey).push({
        value: key,
        type: to.type,
        ...(to.value.node.loc ? to.value.node.loc.start : {})
      });
    }
  }

  private getNodeHash(node: t.Node) {
    if (node.loc) {
      const { start, end } = node.loc;
      return `${start.line},${start.column},${end.line},${end.column}`;
    }
    if (!this.nodeHashMap.has(node)) {
      this.nodeHashMap.set(node, `${++this.id}`);
    }

    return this.nodeHashMap.get(node);
  }

  private getStatementKey(node: t.Node) {
    return `${node.type}-${this.getNodeHash(node)}`;
  }
}
