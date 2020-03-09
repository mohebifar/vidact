import { Scope } from "@babel/traverse";
import * as t from "@babel/types";

import { ElementDefenition } from "../astGenerator/elementDefinitions";
import { ELEMENT_VAR } from "../constants";
import isNativeTag from "../utils/isNativeTag";

const multiSpaceRegex = /[\s\r\n]{2,}/g;

export function shallowTraverseJSXElement(
  element:
    | t.JSXText
    | t.JSXExpressionContainer
    | t.JSXSpreadChild
    | t.JSXElement
    | t.JSXFragment
    | t.JSXEmptyExpression,
  state: {
    elements: ElementDefenition[];
  },
  scope: Scope,
  namePrefix = ELEMENT_VAR,
  shouldTrim = false
) {
  const identifier = scope.generateUidIdentifier(namePrefix);

  switch (element.type) {
    case "JSXElement":
      const tagIdentifier = element.openingElement.name as t.JSXIdentifier;
      const children = element.children
        .map((child, i) => {
          const shouldTrimNext =
            i === 0 || element.children[i - 1].type !== "JSXElement";

          return shallowTraverseJSXElement(
            child,
            state,
            scope,
            identifier.name,
            shouldTrimNext
          );
        })
        .filter(value => value);
      state.elements.push({
        type: "node",
        tag: tagIdentifier.name,
        isNative: isNativeTag(tagIdentifier.name),
        identifier,
        children
      });
      break;
    case "JSXText":
      const value = element.value.replace(multiSpaceRegex, " ");
      if (shouldTrim && value.trim() === "") {
        return undefined;
      }
      state.elements.push({
        type: "text",
        identifier,
        value
      });
      break;
    case "JSXExpressionContainer":
      state.elements.push({
        type: "expr",
        expression: element.expression,
        identifier
      });
      break;
    default:
      console.log(element);
  }

  return identifier;
}
