// oxlint-disable-next-line typescript/triple-slash-reference -- Include the build define in consuming TypeScript programs.
/// <reference path="./env.d.ts" />

import { Fragment, h, type DirectChild, type DirectComponent } from './direct-dom.ts'
import { cloneRenderable, isRenderable, type CompiledRenderable } from './renderable.ts'

type ElementType = string | typeof Fragment | DirectComponent | CompiledRenderable

interface JsxProps extends Record<string, unknown> {
  readonly children?: DirectChild | readonly DirectChild[]
}

export { Fragment }

export function jsx(type: ElementType, props: JsxProps | null, _key?: unknown): DirectChild {
  if (isRenderable(type)) return cloneRenderable(type, props ?? {})
  const children = props?.children
  const hasChildren = props !== null && Object.hasOwn(props, 'children')
  if (!hasChildren) return h(type, props)
  return h(type, props, children)
}

export function jsxs(type: ElementType, props: JsxProps | null, _key?: unknown): DirectChild {
  if (isRenderable(type)) return cloneRenderable(type, props ?? {})
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
