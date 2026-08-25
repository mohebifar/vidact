// oxlint-disable-next-line typescript/triple-slash-reference -- Include compiler feature defines.
/// <reference path="./env.d.ts" />

import {
  createResource as createAsyncResource,
  lazy as createLazyComponent,
  useAsync,
} from './compiled/async-resource.ts'
import {
  Suspense as createSuspenseComponent,
  createCompiledAsync as createAsyncSlot,
  suspense as createSuspenseBinding,
} from './compiled/core.ts'
import {
  ASYNC_RESOURCE,
  type AsyncResourceState,
  type CompiledContext,
  type CompiledRenderValue,
  type CompiledRenderValue as LazyRenderValue,
  type CompiledScope,
  type StructuralBinding,
} from './compiled/types.ts'
import type { SourceMask } from './source-mask.ts'
import type { StateSlot } from './state-slot.ts'

export interface AsyncResource<Value> {
  readonly [ASYNC_RESOURCE]: AsyncResourceState<Value>
}

export interface ResourceOptions {
  readonly cancel?: () => void
}

export interface LazyModule<Props extends Record<string, unknown>> {
  readonly default: (props: Props) => LazyRenderValue
}

export function createResource<Value>(
  input: PromiseLike<Value>,
  options: ResourceOptions = {},
): AsyncResource<Value> {
  return createAsyncResource(input, options)
}

export function use<Value>(
  input: CompiledContext<Value> | AsyncResource<Value> | PromiseLike<Value>,
): Value {
  return useAsync(input)
}

export function lazy<Props extends Record<string, unknown>>(
  load: () => PromiseLike<LazyModule<Props>>,
): (props: Props) => CompiledRenderValue {
  return createLazyComponent(load)
}

export function suspense(
  render: () => CompiledRenderValue,
  fallback: () => CompiledRenderValue,
): StructuralBinding {
  return createSuspenseBinding(render, fallback)
}

export function createCompiledAsync<Value>(
  scope: CompiledScope,
  reads: SourceMask,
  writes: SourceMask,
  evaluate: () => CompiledContext<Value> | AsyncResource<Value> | PromiseLike<Value>,
): StateSlot<Value> {
  return createAsyncSlot(scope, reads, writes, evaluate)
}

export function Suspense(props: {
  readonly children?: (() => CompiledRenderValue) | readonly [() => CompiledRenderValue]
  readonly fallback: () => CompiledRenderValue
}): StructuralBinding {
  return createSuspenseComponent(props)
}
