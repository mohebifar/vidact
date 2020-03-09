import * as t from "@babel/types";

import {
  KEY_ELEMENT,
  KEY_PROP_UPDATE,
  ELEMENT_UPDATER_SUFFIX
} from "../constants";

export interface NodeElementDefinition {
  type: "node";
  isNative?: boolean;
  tag: string;
  identifier: t.Identifier;
  children: t.Identifier[];
}

export interface TextElementDefenition {
  type: "text";
  value: string;
  identifier: t.Identifier;
}

export interface ExpressionElementDefenition {
  type: "expr";
  expression: t.Expression | t.JSXEmptyExpression;
  identifier: t.Identifier;
}

export type ElementDefenition =
  | NodeElementDefinition
  | TextElementDefenition
  | ExpressionElementDefenition;

export const transformerMap = {
  text: transformText,
  node: transformNode,
  expr: transformExpression
};

export function createComponentElement(elementName: t.Identifier) {
  return t.objectExpression([
    t.objectProperty(t.identifier(KEY_ELEMENT), elementName),
    t.objectProperty(
      t.identifier(KEY_PROP_UPDATE),
      t.identifier(KEY_PROP_UPDATE),
      false,
      true
    )
  ]);
}

export function transformNode(definition: NodeElementDefinition) {
  const result: t.Node[] = createCreateElement(definition);

  if (definition.children.length > 0) {
    result.push(createAppend(definition.identifier, definition.children));
  }

  return result;
}

export function transformText(definition: TextElementDefenition) {
  const variableDeclarator = t.variableDeclarator(
    definition.identifier,
    createCreateTextNode(definition.value)
  );
  const elementDeclarator = t.variableDeclaration("let", [variableDeclarator]);

  return elementDeclarator;
}

export function transformExpression(definition: ExpressionElementDefenition) {
  const updateFunctionIdentifier = t.identifier(
    definition.identifier.name + ELEMENT_UPDATER_SUFFIX
  );
  const elementDeclarator = t.variableDeclaration("let", [
    t.variableDeclarator(definition.identifier)
  ]);
  const expressionUpdateDeclarator = t.variableDeclaration("const", [
    t.variableDeclarator(
      updateFunctionIdentifier,
      t.arrowFunctionExpression(
        [],
        t.blockStatement([
          t.ifStatement(
            t.unaryExpression("!", definition.identifier),
            t.expressionStatement(
              t.assignmentExpression(
                "=",
                definition.identifier,
                createCreateTextNode()
              )
            )
          ),
          t.expressionStatement(
            t.assignmentExpression(
              "=",
              t.memberExpression(
                definition.identifier,
                t.identifier("textContent")
              ),
              definition.expression as t.Expression
            )
          )
        ])
      )
    )
  ]);
  const callUpdateExpress = t.callExpression(updateFunctionIdentifier, []);

  return [elementDeclarator, expressionUpdateDeclarator, callUpdateExpress];
}

function createCreateElement(definition: NodeElementDefinition): t.Node[] {
  return definition.isNative
    ? createCreateNativeElement(definition)
    : createCreateComponentElement(definition);
}

function createCreateNativeElement(
  definition: NodeElementDefinition
): t.Node[] {
  return [
    t.variableDeclaration("let", [
      t.variableDeclarator(
        definition.identifier,
        t.callExpression(
          t.memberExpression(
            t.identifier("document"),
            t.identifier("createElement")
          ),
          [t.stringLiteral(definition.tag)]
        )
      )
    ])
  ];
}

function createCreateComponentElement(
  definition: NodeElementDefinition
): t.Node[] {
  const elInstanceId = t.identifier(definition.identifier.name + "_instance");
  const callExpression = t.callExpression(t.identifier(definition.tag), []);
  const instanceDeclarator = t.variableDeclarator(elInstanceId, callExpression);
  const elementDeclarator = t.variableDeclarator(
    definition.identifier,
    t.memberExpression(elInstanceId, t.identifier(KEY_ELEMENT))
  );
  const elementDeclaration = t.variableDeclaration("let", [
    instanceDeclarator,
    elementDeclarator
  ]);
  return [elementDeclaration];
}

function createCreateTextNode(value = "") {
  return t.callExpression(
    t.memberExpression(
      t.identifier("document"),
      t.identifier("createTextNode")
    ),
    [t.stringLiteral(value)]
  );
}

function createAppend(parent: t.Identifier, children: t.Identifier[]) {
  return t.callExpression(
    t.memberExpression(parent, t.identifier("append"), false),
    children
  );
}
