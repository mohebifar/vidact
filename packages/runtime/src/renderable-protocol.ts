export const RENDERABLE = Symbol.for('vidact.v1.Renderable')

export interface RenderableProtocol {
  readonly [RENDERABLE]: {
    readonly identity: unknown
    readonly input: unknown
    readonly reconcile: boolean
    readonly construct: (input: never) => unknown
  }
}

/**
 * Cloning a renderable pulls in the element-construction module, which most
 * compiled apps never touch. The renderable module registers its clone the
 * first time an element capability is created, so `jsx` can reach it without
 * importing it, and bundles that never build elements leave it out.
 */
export type RenderableClone = (
  value: RenderableProtocol,
  overrides: Record<string, unknown>,
) => unknown

let renderableClone: RenderableClone | undefined

export function installRenderableClone(clone: RenderableClone): void {
  renderableClone = clone
}

export function renderableCloneHandler(): RenderableClone | undefined {
  return renderableClone
}

export function isRenderableProtocol(value: unknown): value is RenderableProtocol {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.hasOwn(value, RENDERABLE) &&
    typeof (value as RenderableProtocol)[RENDERABLE]?.construct === 'function'
  )
}

export function materializeRenderable(value: RenderableProtocol): unknown {
  const internals = value[RENDERABLE]
  return internals.construct(internals.input as never)
}

export function materializeRenderableWithInput(value: RenderableProtocol, input: unknown): unknown {
  return value[RENDERABLE].construct(input as never)
}

export function renderableIdentity(value: RenderableProtocol): unknown {
  return value[RENDERABLE].identity
}

export function canReconcileRenderable(value: RenderableProtocol): boolean {
  return value[RENDERABLE].reconcile
}

export function renderablePropsSnapshot(value: RenderableProtocol): Record<PropertyKey, unknown> {
  const props = (value as RenderableProtocol & { readonly props: Record<PropertyKey, unknown> })
    .props
  return Object.fromEntries(Reflect.ownKeys(props).map((name) => [name, Reflect.get(props, name)]))
}
