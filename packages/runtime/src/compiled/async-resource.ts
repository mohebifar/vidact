import { isPromiseLike } from '../shared/promise.ts'
import { DEV, isCompiledContext, useContext } from './core.ts'
import {
  ASYNC_RESOURCE,
  SUSPENSION,
  type AsyncResource,
  type AsyncResourceState,
  type CompiledContext,
  type CompiledRenderValue,
  type LazyModule,
  type ResourceOptions,
  type Suspension,
} from './types.ts'

const noop = (): void => {}
const promiseResources = new WeakMap<object, AsyncResource<unknown>>()

export function createResource<Value>(
  input: PromiseLike<Value>,
  options: ResourceOptions = {},
): AsyncResource<Value> {
  if (!isPromiseLike(input)) {
    throw new TypeError(DEV ? 'createResource requires a promise-like value' : 'V029')
  }
  const existing = promiseResources.get(input as object) as AsyncResource<Value> | undefined
  if (existing !== undefined) return existing
  const state: AsyncResourceState<Value> = {
    status: 'pending',
    value: undefined,
    reason: undefined,
    listeners: new Set(),
    cancel: options.cancel,
    subscribers: 0,
  }
  const resource: AsyncResource<Value> = { [ASYNC_RESOURCE]: state }
  promiseResources.set(input as object, resource as AsyncResource<unknown>)
  void Promise.resolve(input).then(
    (value) => settleResource(state, 'fulfilled', value),
    (reason: unknown) => settleResource(state, 'rejected', reason),
  )
  return resource
}

export function useAsync<Value>(
  input: CompiledContext<Value> | AsyncResource<Value> | PromiseLike<Value>,
): Value {
  if (isCompiledContext<Value>(input)) return useContext(input)
  return readResource(isAsyncResource<Value>(input) ? input : createResource(input))
}

export function lazy<Props extends Record<string, unknown>>(
  load: () => PromiseLike<LazyModule<Props>>,
): (props: Props) => CompiledRenderValue {
  let resource: AsyncResource<LazyModule<Props>> | undefined
  return (props) => {
    resource ??= createResource(load())
    const module = readResource(resource)
    if (typeof module?.default !== 'function') {
      throw new TypeError(DEV ? 'lazy loader must resolve to a default component export' : 'V030')
    }
    return module.default(props)
  }
}

function isAsyncResource<Value>(value: unknown): value is AsyncResource<Value> {
  return typeof value === 'object' && value !== null && ASYNC_RESOURCE in value
}

export function isSuspension(value: unknown): value is Suspension {
  return typeof value === 'object' && value !== null && SUSPENSION in value
}

function readResource<Value>(resource: AsyncResource<Value>): Value {
  const state = resource[ASYNC_RESOURCE]
  if (state.status === 'fulfilled') return state.value as Value
  if (state.status === 'rejected') throw state.reason
  throw { [SUSPENSION]: true, resource } satisfies Suspension
}

export function subscribeResource(
  resource: AsyncResource<unknown>,
  listener: () => void,
): () => void {
  const state = resource[ASYNC_RESOURCE]
  if (state.status !== 'pending') {
    queueMicrotask(listener)
    return noop
  }
  let active = true
  state.subscribers += 1
  state.listeners.add(listener)
  return () => {
    if (!active) return
    active = false
    if (state.listeners.delete(listener)) state.subscribers -= 1
    if (state.status === 'pending' && state.subscribers === 0) state.cancel?.()
  }
}

function settleResource<Value>(
  state: AsyncResourceState<Value>,
  status: 'fulfilled' | 'rejected',
  result: Value | unknown,
): void {
  if (state.status !== 'pending') return
  state.status = status
  if (status === 'fulfilled') state.value = result as Value
  else state.reason = result
  const listeners = [...state.listeners]
  state.listeners.clear()
  state.subscribers = 0
  for (const listener of listeners) listener()
}
