import ts from "typescript";

let i = 0;

export function safeCreateUniqueName(
  text: string,
  flags?: ts.GeneratedIdentifierFlags
) {
  try {
    return ts.factory.createUniqueName(text, flags);
  } catch {
    return ts.factory.createIdentifier(`${text}_${i++}`);
  }
}
