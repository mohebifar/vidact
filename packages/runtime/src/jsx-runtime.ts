import { Fragment, h, type DirectChild, type DirectComponent } from './direct-dom.ts'

type ElementType = string | typeof Fragment | DirectComponent

interface JsxProps extends Record<string, unknown> {
  readonly children?: DirectChild | readonly DirectChild[]
}

export { Fragment }

export function jsx(type: ElementType, props: JsxProps | null, key?: unknown): Node {
  const { children, ...attributes } = props ?? {}
  const normalizedChildren = Array.isArray(children) ? children : [children]
  return h(type, key === undefined ? attributes : { ...attributes, key }, ...normalizedChildren)
}

export const jsxs = jsx
