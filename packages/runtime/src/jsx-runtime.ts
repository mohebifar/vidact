import { Fragment, h, type DirectChild, type DirectComponent } from './direct-dom.ts'

type ElementType = string | typeof Fragment | DirectComponent

interface JsxProps extends Record<string, unknown> {
  readonly children?: DirectChild | readonly DirectChild[]
}

export { Fragment }

export function jsx(type: ElementType, props: JsxProps | null, key?: unknown): DirectChild {
  const { children, ...attributes } = props ?? {}
  const hasChildren = props !== null && Object.hasOwn(props, 'children')
  const normalizedChildren =
    hasChildren && typeof type === 'function' && Array.isArray(children) ? children : [children]
  return h(
    type,
    key === undefined ? attributes : { ...attributes, key },
    ...(hasChildren ? normalizedChildren : []),
  )
}

export const jsxs = jsx
