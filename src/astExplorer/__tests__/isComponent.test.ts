import * as t from "@babel/types";

import { createNodePath } from "../../__tests__/utils";
import { isComponent } from "../isComponent";

describe("isComponent", () => {
  it("returns true if function name is pascal case", () => {
    const path = createNodePath(
      t.functionDeclaration(
        t.identifier("MyComponent"),
        [],
        t.blockStatement([])
      )
    );
    expect(isComponent(path)).toStrictEqual(true);
  });

  it("returns true if function name starts with a lower case character", () => {
    const path = createNodePath(
      t.functionDeclaration(
        t.identifier("myComponent"),
        [],
        t.blockStatement([])
      )
    );
    expect(isComponent(path)).toStrictEqual(false);
  });
});
