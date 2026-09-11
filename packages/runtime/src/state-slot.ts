import type { SourceMask } from './source-mask.ts'

export type StateUpdate<T> = T | ((previous: T) => T)

export interface DeferredStateWrite<T> {
  readonly slot: object
  readonly revision: number
  readonly update: StateUpdate<T>
  readonly commit: (update: StateUpdate<T>) => void
  readonly currentRevision: () => number
}

export type StateWriteInterceptor = <T>(write: DeferredStateWrite<T>) => boolean

let stateWriteInterceptor: StateWriteInterceptor | undefined

export function installStateWriteInterceptor(interceptor: StateWriteInterceptor): void {
  stateWriteInterceptor = interceptor
}

export interface StateSlot<T> {
  readonly get: () => T
  readonly set: (update: StateUpdate<T>) => void
  readonly replace: (value: T) => void
}

export interface ReadOnlyStateInvalidationTarget {
  readonly [1]: (sources: SourceMask) => void
}

export interface ReadOnlyStateCell<T> extends Pick<StateSlot<T>, 'get'> {
  value: T
  revision?: number
  readonly invalidationTarget: ReadOnlyStateInvalidationTarget
  readonly source: SourceMask
}

export function createReadOnlyStateSlot<T>(
  invalidationTarget: ReadOnlyStateInvalidationTarget,
  source: SourceMask,
  initialValue: T,
): ReadOnlyStateCell<T> {
  return {
    value: initialValue,
    invalidationTarget,
    source,
    get: readReadOnlyState,
  }
}

function readReadOnlyState<T>(this: ReadOnlyStateCell<T>): T {
  return this.value
}

export function replaceReadOnlyStateSlot<T>(cell: ReadOnlyStateCell<T>, replacement: T): void {
  if (Object.is(cell.value, replacement)) return
  const revision = cell.revision ?? 0
  if (
    stateWriteInterceptor?.({
      slot: cell,
      revision,
      update: replacement,
      commit: (pending) => applyReadOnlyState(cell, pending as T),
      currentRevision: () => cell.revision ?? 0,
    })
  ) {
    cell.revision ??= revision
    return
  }
  applyReadOnlyState(cell, replacement)
}

function applyReadOnlyState<T>(cell: ReadOnlyStateCell<T>, next: T): void {
  if (Object.is(cell.value, next)) return
  cell.value = next
  if (cell.revision !== undefined) cell.revision += 1
  cell.invalidationTarget[1](cell.source)
}

export function createStateSlot<T>(
  invalidate: (sources: SourceMask) => void,
  source: SourceMask,
  initialValue: T,
  assertWritable?: () => void,
): StateSlot<T> {
  let value = initialValue
  let revision = 0
  let token: object | undefined

  const apply = (next: T): void => {
    if (Object.is(value, next)) return

    value = next
    revision += 1
    invalidate(source)
  }

  return {
    get: () => value,
    set: (update) => {
      assertWritable?.()
      if (
        stateWriteInterceptor?.({
          slot: (token ??= {}),
          revision,
          update,
          commit: (pending) =>
            apply(typeof pending === 'function' ? (pending as (previous: T) => T)(value) : pending),
          currentRevision: () => revision,
        })
      ) {
        return
      }
      apply(typeof update === 'function' ? (update as (previous: T) => T)(value) : update)
    },
    replace: (replacement) => {
      assertWritable?.()
      if (
        stateWriteInterceptor?.({
          slot: (token ??= {}),
          revision,
          update: replacement,
          commit: (pending) => apply(pending as T),
          currentRevision: () => revision,
        })
      ) {
        return
      }
      apply(replacement)
    },
  }
}
