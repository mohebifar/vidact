import * as t from "@babel/types";
import { parseSync } from "@babel/core";
import traverse, { Hub, NodePath } from "@babel/traverse";

export function createNodePath<T extends t.Node>(node: T) {
  const path: NodePath<T> = new NodePath(new Hub(null, {}), null);
  path.node = node;
  return path;
}

export function getNodePathForType<
  Type extends t.Node["type"],
  NodeType = Extract<t.Node, { type: Type }>,
  NodePathType = NodePath<NodeType>
>(node: t.Node, type: Type) {
  const paths: NodePathType[] = [];

  traverse(node, {
    [type]: (path: NodePathType) => {
      paths.push(path);
    }
  });

  return paths;
}

export function parseJSX(code: string) {
  return parseSync(code, {
    plugins: ["@babel/plugin-syntax-jsx"]
  });
}
