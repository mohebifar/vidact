import ts from "typescript";
import { StatementDescriptor } from "../types";
import { simplifyVariableDeclaration } from "./simplifyVariableDeclaration";

export function createExecutorStatements({
  dependencies,
  statement,
}: StatementDescriptor) {
  if (dependencies.length === 0) {
    return null;
  }

  let statements: ts.Statement[] = [];
  let wrappedStatements: ts.Statement[] = [];

  if (ts.isVariableStatement(statement)) {
    const newDeclarations = simplifyVariableDeclaration(
      statement.declarationList
    );

    const declarationMap = newDeclarations.flatMap((declarationList) =>
      declarationList.declarations.map(
        (declaration) =>
          [declaration.name as ts.Identifier, declaration.initializer] as const
      )
    );

    wrappedStatements = declarationMap.map(([name, initializer]) =>
      ts.factory.createExpressionStatement(
        ts.factory.createAssignment(
          name,
          initializer || ts.factory.createIdentifier("undefined")
        )
      )
    );

    statements.push(
      ts.factory.createVariableStatement(
        [],
        ts.factory.createVariableDeclarationList(
          declarationMap.map(([name]) =>
            ts.factory.createVariableDeclaration(name)
          )
        )
      )
    );
  } else {
    wrappedStatements = [statement];
  }

  const name = ts.factory.createUniqueName("__vdExecutor");
  const executor = ts.factory.createVariableStatement(
    [],
    ts.factory.createVariableDeclarationList([
      ts.factory.createVariableDeclaration(
        name,
        undefined,
        undefined,
        ts.factory.createArrowFunction(
          undefined,
          undefined,
          [],
          undefined,
          undefined,
          ts.factory.createBlock(wrappedStatements, true)
        )
      ),
    ])
  );
  const callExecutor = ts.factory.createExpressionStatement(
    ts.factory.createCallExpression(name, [], [])
  );

  statements.push(executor, callExecutor);

  return {
    name,
    statements,
  };
}
