export const RENDERABLE = Symbol.for('vidact.v1.Renderable')

export interface RenderableProtocol {
  readonly [RENDERABLE]: {
    readonly input: unknown
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
