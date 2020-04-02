import * as t from "@babel/types";
import { parseSync } from "@babel/core";
import traverse, { Hub, NodePath } from "@babel/traverse";

export function createNodePath<T extends t.Node>(node: T) {
  const path: NodePath<T> = new NodePath(new Hub(null, {}), null);
  path.node = node;
  return path;
}

export function getNodePathForType(node: t.Node, type: t.Node["type"]) {
  const paths: NodePath[] = [];

  traverse(node, {
    [type]: (path: NodePath) => {
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
