import * as t from "@babel/types";

import { ComponentState } from "../plugin";
import {
  KEY_ELEMENT,
  KEY_PROP_UPDATER,
  ELEMENT_UPDATER_SUFFIX,
  PROP_VAR_TRANSACTION_VAR
} from "../constants";
import { createStatementUpdater } from "./createStatementUpdater";

export interface NodeElementDefinition {
  type: "node";
  isNative?: boolean;
  tag: string;
  identifier: t.Identifier;
  children: t.Identifier[];
  attributes?: t.JSXOpeningElement["attributes"];
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

export function createComponentElement(
  elementName: t.Expression,
  propUpdater: t.Expression
) {
  return t.objectExpression([
    t.objectProperty(t.identifier(KEY_ELEMENT), elementName),
    t.objectProperty(t.identifier(KEY_PROP_UPDATER), propUpdater)
  ]);
}

export function transformNode(
  definition: NodeElementDefinition,
  state: ComponentState
) {
  state.moduleDependencies.add("createElement");
  const result: t.Node[] = createCreateElement(definition, state);

  if (definition.children.length > 0) {
    state.moduleDependencies.add("append");
    result.push(createAppend(definition.identifier, definition.children));
  }

  return result;
}

export function transformText(
  definition: TextElementDefenition,
  state: ComponentState
) {
  state.moduleDependencies.add("createText");
  const variableDeclarator = t.variableDeclarator(
    definition.identifier,
    createCreateTextNode(definition.value)
  );
  const elementDeclarator = t.variableDeclaration("let", [variableDeclarator]);

  return elementDeclarator;
}

export function transformExpression(
  definition: ExpressionElementDefenition,
  state: ComponentState
) {
  state.moduleDependencies.add("createText");
  state.moduleDependencies.add("setContent");
  const updateFunctionIdentifier = t.identifier(
    definition.identifier.name + ELEMENT_UPDATER_SUFFIX
  );
  const elementDeclarator = t.variableDeclaration("let", [
    t.variableDeclarator(definition.identifier)
  ]);
  const expression = definition.expression as t.Expression;
  t.traverse(expression, node => {
    if (t.isArrowFunctionExpression(node) && !t.isBlockStatement(node.body)) {
      node.body = t.blockStatement([t.returnStatement(node.body)]);
    }
  });

  const block = t.blockStatement([
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
        definition.identifier,
        t.callExpression(t.identifier("setContent"), [
          definition.identifier,
          expression
        ])
      )
    )
  ]);
  const [updater, callUpdater] = createStatementUpdater(
    block,
    updateFunctionIdentifier
  );

  return [elementDeclarator, updater, callUpdater];
}

function createCreateElement(
  definition: NodeElementDefinition,
  state: ComponentState
): t.Node[] {
  return definition.isNative
    ? createCreateNativeElement(definition, state)
    : createCreateComponentElement(definition, state);
}

function createCreateNativeElement(
  definition: NodeElementDefinition,
  state: ComponentState
): t.Node[] {
  const attributeSet = createNativeSetAttribute(definition, state);

  return [
    t.variableDeclaration("let", [
      t.variableDeclarator(
        definition.identifier,
        t.callExpression(t.identifier("createElement"), [
          t.stringLiteral(definition.tag)
        ])
      )
    ]),
    ...attributeSet
  ];
}

function createNativeSetAttribute(
  definition: NodeElementDefinition,
  state: ComponentState
): t.Node[] {
  if (!definition.attributes || definition.attributes.length === 0) {
    return [];
  }

  const attributeSet: t.Node[] = [];
  state.moduleDependencies.add("setProperty");

  for (const attr of definition.attributes) {
    if (!t.isJSXAttribute(attr)) {
      continue;
    }

    const propName = attr.name.name as string;
    const value: t.Expression =
      (t.isStringLiteral(attr.value) && attr.value) ||
      (t.isJSXExpressionContainer(attr.value) &&
        !t.isJSXEmptyExpression(attr.value.expression) &&
        attr.value.expression) ||
      t.booleanLiteral(true);

    attributeSet.push(
      t.expressionStatement(
        t.callExpression(t.identifier("setProperty"), [
          definition.identifier,
          t.stringLiteral(propName),
          value
        ])
      )
    );
  }

  return attributeSet;
}

function createCreateComponentElement(
  definition: NodeElementDefinition,
  state: ComponentState
): t.Node[] {
  const elInstanceId = t.identifier(definition.identifier.name + "_instance");
  const [updateAttrStatements, init] = createComponentSetAttribute(
    definition,
    elInstanceId,
    state
  );
  const callExpression = t.callExpression(t.identifier(definition.tag), [init]);
  const instanceDeclarator = t.variableDeclarator(elInstanceId, callExpression);
  const elementDeclarator = t.variableDeclarator(
    definition.identifier,
    t.memberExpression(elInstanceId, t.identifier(KEY_ELEMENT))
  );
  const elementDeclaration = t.variableDeclaration("let", [
    instanceDeclarator,
    elementDeclarator
  ]);
  return [elementDeclaration, ...updateAttrStatements];
}

function createComponentSetAttribute(
  definition: NodeElementDefinition,
  instanceId: t.Identifier,
  state: ComponentState
): [t.Node[], t.ObjectExpression | undefined] {
  if (!definition.attributes || definition.attributes.length === 0) {
    return [[], undefined];
  }

  const attributeSet: t.Node[] = [];
  const objProperties: t.ObjectProperty[] = [];

  for (const attr of definition.attributes) {
    if (!t.isJSXAttribute(attr)) {
      continue;
    }

    const propName = attr.name.name;
    const propId = t.identifier(propName);
    const literalValue = t.isStringLiteral(attr.value) && attr.value;

    const value: t.Expression =
      literalValue ||
      (t.isJSXExpressionContainer(attr.value) &&
        !t.isJSXEmptyExpression(attr.value.expression) &&
        attr.value.expression) ||
      t.booleanLiteral(true);

    objProperties.push(t.objectProperty(propId, value));

    if (literalValue) {
      continue;
    }

    state.moduleDependencies.add("addPropTransaction");
    state.needsPropTransaction = true;
    attributeSet.push(
      t.expressionStatement(
        t.callExpression(t.identifier("addPropTransaction"), [
          t.identifier(PROP_VAR_TRANSACTION_VAR),
          instanceId,
          t.stringLiteral(propId.name),
          value
        ])
      )
    );
  }

  return [attributeSet, t.objectExpression(objProperties)];
}

function createCreateTextNode(value?: string) {
  return t.callExpression(
    t.identifier("createText"),
    value ? [t.stringLiteral(value)] : []
  );
}

function createAppend(parent: t.Identifier, children: t.Identifier[]) {
  return t.expressionStatement(
    t.callExpression(t.identifier("append"), [parent, ...children])
  );
}
