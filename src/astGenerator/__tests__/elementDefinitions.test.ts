import * as t from "@babel/types";

import { createComponentElement } from "../elementDefinitions";

describe("createComponentElement", () => {
  it("wraps the given statement within an arrow function declaration and returns as the first value", () => {
    const elementId = t.identifier("el");
    const propUpdaterId = t.identifier("propUpdater");

    const elementExpression = createComponentElement(
      t.identifier("el"),
      t.identifier("propUpdater")
    );
    expect(elementExpression).toMatchObject(
      t.objectExpression([
        t.objectProperty(t.identifier("element"), elementId),
        t.objectProperty(t.identifier("updateProps"), propUpdaterId)
      ])
    );
  });
});

it.todo("transformNode");

it.todo("transformText");

it.todo("transformExpression");
