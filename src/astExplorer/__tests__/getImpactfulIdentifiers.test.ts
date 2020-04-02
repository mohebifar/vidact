import { getNodePathForType, parseJSX } from "../../__tests__/utils";
import { getImpactfulIdentifiers } from "../getImpactfulIdentifiers";

describe("getStatementUpdaterIdentifier", () => {
  it("finds prop references and returns a record for it in the result with type prop", () => {
    const ast = parseJSX("<div>{__internal_props.name}</div>");
    const [path] = getNodePathForType(ast, "JSXElement");
    const ids = getImpactfulIdentifiers(path.node, path.scope, path.parentPath);
    expect(ids).toContainEqual(["prop", "name"]);
  });

  it("finds any variable references and returns a record for it in the result with type local", () => {
    const ast = parseJSX("<div>{myVar}</div>");
    const [path] = getNodePathForType(ast, "JSXElement");
    const ids = getImpactfulIdentifiers(path.node, path.scope, path.parentPath);
    expect(ids).toContainEqual(["local", "myVar"]);
  });

  it("finds any variable references as object and returns a record for it in the result with type local", () => {
    const ast = parseJSX("<div>{myVar.foo.bar}</div>");
    const [path] = getNodePathForType(ast, "JSXElement");
    const ids = getImpactfulIdentifiers(path.node, path.scope, path.parentPath);
    expect(ids).toContainEqual(["local", "myVar"]);
  });

  it("excludes element variables", () => {
    const ast = parseJSX("fn(_el_2)");
    const [path] = getNodePathForType(ast, "CallExpression");
    const ids = getImpactfulIdentifiers(path.node, path.scope, path.parentPath);
    expect(ids).toHaveLength(1);
    expect(ids).toEqual([["local", "fn"]]);
  });
});
