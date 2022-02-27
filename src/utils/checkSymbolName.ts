import ts from "typescript";

export function checkSymbolName(
  name: string | string[],
  symbol?: ts.Symbol
): boolean {
  if (!symbol) {
    return false;
  }
  const separatedName = typeof name === "string" ? name.split(".") : name;

  const currentPart = symbol.escapedName === separatedName.pop();
  if (separatedName.length === 0) {
    return currentPart;
  }

  return currentPart && checkSymbolName(separatedName, (symbol as any).parent);
}
