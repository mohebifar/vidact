import * as fs from "fs";
import { parseSync, traverse, ParseResult } from "@babel/core";
import * as t from "@babel/types";

const runtimeModules = <const>[
  "propUpdater",
  "createElement",
  "createText",
  "append",
  "setContent",
  "consolidateExecuters",
  "addPropTransaction",
];

export type RuntimeModule = typeof runtimeModules[number];
export type RuntimeModuleSet = Set<RuntimeModule>;

let inlineFiles: Map<string, ParseResult>;

function getInlineRuntimeHelpers() {
  if (inlineFiles) {
    return inlineFiles;
  }

  inlineFiles = new Map<string, any>();

  for (const module of runtimeModules) {
    const code = fs
      .readFileSync(`${__dirname}/../../src/runtime/${module}.js`)
      .toString();
    const ast = parseSync(code, { babelrc: false });
    traverse(ast, {
      ExportNamedDeclaration(path) {
        path.replaceWith(path.node.declaration);
      },
      ImportDeclaration(path) {
        path.remove();
      },
    });
    inlineFiles.set(module, ast);
  }

  return inlineFiles;
}

export function getModuleDeclarations(
  set: RuntimeModuleSet,
  type: "inline" | "module"
): t.Node[] {
  const modules = Array.from(set);
  if (modules.length === 0) {
    return [];
  }

  if (type === "inline") {
    const inlineModules = getInlineRuntimeHelpers();
    return modules.map((module) => inlineModules.get(module));
  }

  return [
    t.addComment(
      t.importDeclaration(
        modules.map((module) =>
          t.importSpecifier(t.identifier(module), t.identifier(module))
        ),
        t.stringLiteral("vidact/runtime")
      ),
      "trailing",
      "--- Import Vidact Runtime Helpers ---"
    ),
  ];
}
