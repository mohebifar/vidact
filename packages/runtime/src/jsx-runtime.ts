// oxlint-disable-next-line typescript/triple-slash-reference -- Include the build define in consuming TypeScript programs.
/// <reference path="./env.d.ts" />

import { h, type DirectChild, type DirectComponent } from './direct-dom.ts'
import {
  isRenderableProtocol,
  renderableCloneHandler,
  type RenderableProtocol,
} from './renderable-protocol.ts'
import type { CompiledRenderable } from './renderable.ts'

export const Fragment: symbol = Symbol.for('vidact.v1.Fragment')

type ElementType = string | typeof Fragment | DirectComponent | CompiledRenderable

interface JsxProps extends Record<string, unknown> {
  readonly children?: DirectChild | readonly DirectChild[]
}

export function jsx(type: ElementType, props: JsxProps | null, _key?: unknown): DirectChild {
  if (isRenderableProtocol(type)) return cloneElementType(type, props)
  const children = props?.children
  const hasChildren = props !== null && Object.hasOwn(props, 'children')
  if (!hasChildren) return h(type, props)
  return h(type, props, children)
}

export function jsxs(type: ElementType, props: JsxProps | null, _key?: unknown): DirectChild {
  if (isRenderableProtocol(type)) return cloneElementType(type, props)
  const children = props?.children
  const hasChildren = props !== null && Object.hasOwn(props, 'children')
  if (!hasChildren) return h(type, props)
  return Array.isArray(children) ? h(type, props, ...children) : h(type, props, children)
}

export function jsxDEV(
  type: ElementType,
  props: JsxProps | null,
  key?: unknown,
  isStaticChildren = false,
): DirectChild {
  return isStaticChildren ? jsxs(type, props, key) : jsx(type, props, key)
}

/**
 * A renderable can only reach `jsx` as an element type if something already
 * built one, which is what registers the clone.
 */
function cloneElementType(type: RenderableProtocol, props: JsxProps | null): DirectChild {
  const clone = renderableCloneHandler()
  if (clone === undefined) {
    throw new TypeError('V107')
  }
  return clone(type, props ?? {}) as DirectChild
}
