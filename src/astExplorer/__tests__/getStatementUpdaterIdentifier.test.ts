import * as t from "@babel/types";

import { createNodePath } from "../../__tests__/utils";
import getStatementUpdaterIdentifier from "../getStatementUpdaterIdentifier";

describe("getStatementUpdaterIdentifier", () => {
  it("returns declared variable name", () => {
    const path = createNodePath(
      t.variableDeclaration("const", [
        t.variableDeclarator(t.identifier("elUpdater"), t.identifier("value"))
      ])
    );
    expect(getStatementUpdaterIdentifier(path)).toStrictEqual("elUpdater");
  });

  it("returns the first item if left value is array pattern", () => {
    const path = createNodePath(
      t.variableDeclaration("const", [
        t.variableDeclarator(
          t.arrayPattern([
            t.identifier("elUpdater"),
            t.identifier("el2Updater")
          ]),
          t.identifier("value")
        )
      ])
    );
    expect(getStatementUpdaterIdentifier(path)).toStrictEqual("elUpdater");
  });

  it("throws an error if left value is object pattern", () => {
    const path = createNodePath(
      t.variableDeclaration("const", [
        t.variableDeclarator(t.objectPattern([]), t.identifier("value"))
      ])
    );
    expect(() => getStatementUpdaterIdentifier(path)).toThrow();
  });
});
