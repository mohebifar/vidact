import ts from "typescript";

export const getSyntaxKindName = (kind: ts.SyntaxKind) => {
  for (const name in ts.SyntaxKind) {
    if ((ts.SyntaxKind[name] as any) === kind) {
      return name;
    }
  }

  return null;
};
