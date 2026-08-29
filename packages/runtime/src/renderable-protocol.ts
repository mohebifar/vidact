export const RENDERABLE = Symbol.for('vidact.v1.Renderable')

export interface RenderableProtocol {
  readonly [RENDERABLE]: {
    readonly identity: unknown
    readonly input: unknown
    readonly reconcile: boolean
    readonly construct: (input: never) => unknown
  }
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
