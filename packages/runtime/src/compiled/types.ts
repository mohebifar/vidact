import type { SourceMask } from '../source-mask.ts'

export const BINDING = Symbol.for('vidact.v1.Binding')
export const STRUCTURAL = Symbol.for('vidact.v1.StructuralBinding')
export const CONTEXT = Symbol.for('vidact.v1.Context')
export const ASYNC_RESOURCE = Symbol.for('vidact.v1.AsyncResource')
export const SUSPENSION = Symbol.for('vidact.v1.Suspension')
export const COMPONENT_SPREAD_SOURCE = Symbol.for('vidact.v1.ComponentSpreadSource')

export type CompiledErrorHandler = (error: unknown) => void

export type ProfilerPhase = 'mount' | 'update' | 'nested-update'

export type ProfilerOnRender = (
  id: string,
  phase: ProfilerPhase,
  actualDuration: number,
  baseDuration: number,
  startTime: number,
  commitTime: number,
) => void

export type AsyncResourceState<Value> = {
  status: 'pending' | 'fulfilled' | 'rejected'
  value: Value | undefined
  reason: unknown
  readonly listeners: Set<() => void>
  readonly cancel: (() => void) | undefined
  subscribers: number
}

export interface AsyncResource<Value> {
  readonly [ASYNC_RESOURCE]: AsyncResourceState<Value>
}

export interface ResourceOptions {
  readonly cancel?: () => void
}

export type Suspension = {
  readonly [SUSPENSION]: true
  readonly resource: AsyncResource<unknown>
}

export type LazyModule<Props extends Record<string, unknown>> = {
  readonly default: (props: Props) => CompiledRenderValue
}

export type CompiledScope = readonly [
  add: (reads: SourceMask, run: (active: SourceMask) => void, writes?: SourceMask) => () => void,
  invalidate: (sources: SourceMask) => void,
  batch: <T>(operation: () => T) => T,
  dispose: () => void,
]

export type CompiledBinding<T> = readonly [
  brand: typeof BINDING,
  evaluate: () => T,
  scope: CompiledScope,
  reads: SourceMask,
  additionalScope: CompiledScope | undefined,
  additionalReads: SourceMask | undefined,
]

export type OwnedBlock = readonly [
  brand: typeof STRUCTURAL,
  mount: (parent: Node, before: Node | null) => void,
  hydrationKind?: 'array' | 'slot' | 'transparent',
]

export type StructuralBinding = OwnedBlock
export type CompiledComponentResult = OwnedBlock

export type CompiledRenderValue =
  | Node
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined
  | CompiledBinding<unknown>
  | StructuralBinding
  | readonly CompiledRenderValue[]

export interface CompiledContext<T> {
  (props: {
    readonly children?: CompiledRenderValue | readonly CompiledRenderValue[]
    readonly value: T | CompiledBinding<T>
  }): StructuralBinding
  Provider: CompiledContext<T>
  displayName?: string
  readonly [CONTEXT]: T
}
