import * as t from "@babel/types";

import { getNodePathForType, parseJSX } from "../../__tests__/utils";
import { JSXState } from "../../plugin";
import { shallowTraverseJSXElement } from "../visitJSXElement";

describe("shallowTraverseJSXElement", () => {
  describe("JSX text", () => {
    it("returns an assigend uid for JSXText and adds an element for it to the state", () => {
      const ast = parseJSX("<>Test text</>");
      const [path] = getNodePathForType(ast, "JSXText");
      const state: JSXState = {
        elements: [],
        moduleDependencies: new Set()
      };
      const id = shallowTraverseJSXElement(
        path.node as t.JSXText,
        state,
        path.scope
      );

      expect(id).toMatchObject(t.identifier("_el_"));
      expect(state.elements).toContainEqual({
        identifier: id,
        type: "text",
        value: "Test text"
      });
    });
  });

  describe("JSX element", () => {
    it("returns an assigend uid for JSX element and adds an element to the state", () => {
      const ast = parseJSX("<div />");
      const [path] = getNodePathForType(ast, "JSXElement");
      const state: JSXState = {
        elements: [],
        moduleDependencies: new Set()
      };
      const id = shallowTraverseJSXElement(
        path.node as t.JSXText,
        state,
        path.scope
      );

      expect(id).toMatchObject(t.identifier("_el_"));
      expect(state.elements).toContainEqual({
        attributes: [],
        children: [],
        identifier: id,
        isNative: true,
        tag: "div",
        type: "node"
      });
    });

    it("returns an assigend uid for JSX element and adds an element with isNative = false to the state for tags that are not native to HTML", () => {
      const ast = parseJSX("<Card />");
      const [path] = getNodePathForType(ast, "JSXElement");
      const state: JSXState = {
        elements: [],
        moduleDependencies: new Set()
      };
      const id = shallowTraverseJSXElement(
        path.node as t.JSXText,
        state,
        path.scope
      );

      expect(id).toMatchObject(t.identifier("_el_"));
      expect(state.elements).toContainEqual({
        attributes: [],
        children: [],
        identifier: id,
        isNative: false,
        tag: "Card",
        type: "node"
      });
    });

    it("returns an assigend uid for JSX element and adds an element to the state that includes attributes", () => {
      const ast = parseJSX('<div className="container" />');
      const [path] = getNodePathForType(ast, "JSXElement");
      const state: JSXState = {
        elements: [],
        moduleDependencies: new Set()
      };
      const id = shallowTraverseJSXElement(
        path.node as t.JSXText,
        state,
        path.scope
      );

      expect(id).toMatchObject(t.identifier("_el_"));
      expect(state.elements).toContainEqual({
        attributes: [
          expect.objectContaining({
            type: "JSXAttribute",
            name: expect.objectContaining(t.jsxIdentifier("className")),
            value: expect.objectContaining(t.stringLiteral("container"))
          })
        ],
        children: [],
        identifier: id,
        isNative: true,
        tag: "div",
        type: "node"
      });
    });

    it("returns an assigend uid for JSX element and adds an element to the state that includes text children", () => {
      const ast = parseJSX("<div>My Text</div>");
      const [path] = getNodePathForType(ast, "JSXElement");
      const state: JSXState = {
        elements: [],
        moduleDependencies: new Set()
      };
      const id = shallowTraverseJSXElement(
        path.node as t.JSXText,
        state,
        path.scope
      );

      expect(id).toMatchObject(t.identifier("_el_"));
      expect(state.elements).toContainEqual({
        attributes: [],
        children: [t.identifier("_el_2")],
        identifier: id,
        isNative: true,
        tag: "div",
        type: "node"
      });
      expect(state.elements).toContainEqual({
        identifier: t.identifier("_el_2"),
        type: "text",
        value: "My Text"
      });
    });
  });

  describe("JSX expression", () => {
    it("returns an assigend uid for JSXExpression and adds an element for it to the state", () => {
      const ast = parseJSX("<>{x * 2}</>");
      const [path] = getNodePathForType(ast, "JSXExpressionContainer");
      const [expressionPath] = getNodePathForType(ast, "BinaryExpression");
      const state: JSXState = {
        elements: [],
        moduleDependencies: new Set()
      };
      const id = shallowTraverseJSXElement(
        path.node as t.JSXText,
        state,
        path.scope
      );

      expect(id).toMatchObject(t.identifier("_el_"));
      expect(state.elements).toContainEqual({
        expression: expressionPath.node,
        identifier: id,
        type: "expr"
      });
    });
  });
});
