import * as fs from "fs";
import { parseSync, traverse, ParseResult } from "@babel/core";
import * as t from "@babel/types";

const runtimeModules = <const>[
  "propUpdater",
  "createText",
  "createElement",
  "append",
  "setContent",
  "consolidateExecuters",
  "setProperty",
  "addPropTransaction"
];

export type RuntimeModule = typeof runtimeModules[number];
export type RuntimeModuleSet = Set<RuntimeModule>;

let inlineFiles: Map<string, ParseResult>;

function getInlineRuntime() {
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
      }
    });
    inlineFiles.set(module, ast);
  }

  return inlineFiles;
}

export function getModuleDeclarations(set: RuntimeModuleSet): t.Node[] {
  const inlineModules = getInlineRuntime();
  return Array.from(set).map(module => inlineModules.get(module));
}
