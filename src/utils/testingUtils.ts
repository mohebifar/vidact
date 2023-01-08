import * as path from "path";
import * as fs from "fs";
import * as ts from "typescript";

export function createProgramForTesting(files: { [fileName: string]: string }) {
  const rootDir = path.join(__dirname, "..", "..");
  const outputs: { [fileName: string]: string } = {};

  const compilerOptions: ts.CompilerOptions = {
    lib: ["es2018"],
    target: ts.ScriptTarget.Latest,
    jsx: ts.JsxEmit.Preserve,
    allowSyntheticDefaultImports: true,
  };

  const usedNodeModules: string[] = ["react"];

  const compilerHost: ts.CompilerHost = {
    getSourceFile(filename, _languageVersion) {
      if (filename in files) {
        return ts.createSourceFile(
          filename,
          files[filename],
          ts.ScriptTarget.Latest
        );
      }
      if (filename.indexOf(".d.ts") !== -1) {
        let libFilename = filename;
        if (filename.indexOf("lib.") !== 0) {
          libFilename = "lib." + filename;
        }
        const libPath = path.join(
          rootDir,
          "node_modules",
          "typescript",
          "lib",
          libFilename
        );
        if (fs.existsSync(libPath)) {
          return ts.createSourceFile(
            libFilename,
            fs.readFileSync(libPath).toString(),
            ts.ScriptTarget.Latest
          );
        }
      }
      const nodeModuleName = filename.replace(/\.ts$/, "");
      let filepath = path.join(
        rootDir,
        "node_modules",
        "@types",
        nodeModuleName,
        "index.d.ts"
      );
      if (fs.existsSync(filepath)) {
        usedNodeModules.push("@types/" + nodeModuleName);
        return ts.createSourceFile(
          "index.d.ts",
          fs.readFileSync(filepath).toString(),
          ts.ScriptTarget.Latest
        );
      }
      filepath = path.join(
        rootDir,
        "node_modules",
        nodeModuleName,
        "index.d.ts"
      );
      if (fs.existsSync(filepath)) {
        usedNodeModules.push(nodeModuleName);
        return ts.createSourceFile(
          "index.d.ts",
          fs.readFileSync(filepath).toString(),
          ts.ScriptTarget.Latest
        );
      }
      for (const usedNodeModule of usedNodeModules) {
        filepath = path.join(rootDir, "node_modules", usedNodeModule, filename);
        if (fs.existsSync(filepath)) {
          return ts.createSourceFile(
            filename,
            fs.readFileSync(filepath).toString(),
            ts.ScriptTarget.Latest
          );
        }
      }
      return undefined;
    },
    readFile(fileName: string) {
      return fileName;
    },
    fileExists(_fileName: string) {
      return true;
    },
    getDefaultLibFileName(_options: ts.CompilerOptions) {
      return "lib.d.ts";
    },
    writeFile: function (fileName, data, _writeByteOrderMark) {
      outputs[fileName] = data;
    },
    getDirectories(_path: string) {
      return null as any;
    },
    useCaseSensitiveFileNames: function () {
      return false;
    },
    getCanonicalFileName: function (filename) {
      return filename;
    },
    getCurrentDirectory: function () {
      return "";
    },
    getNewLine: function () {
      return "\n";
    },
  };

  const program = ts.createProgram(
    Object.keys(files),
    compilerOptions,
    compilerHost
  );

  return program;
}

export function parseAndTypeCheckForTesting(code: string) {
  const program = createProgramForTesting({ "test.tsx": code });

  return [
    program.getSourceFile("test.tsx")!,
    program.getTypeChecker(),
  ] as const;
}

export function printAstForTesting(statements: ts.Statement[]) {
  const src = ts.factory.createSourceFile(
    statements,
    ts.factory.createToken(ts.SyntaxKind.EndOfFileToken),
    ts.NodeFlags.None
  );

  (src as any).identifiers = new Set();

  return ts.createPrinter().printFile(src);
}
