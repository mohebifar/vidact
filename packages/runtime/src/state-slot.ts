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

export function createStateSlot<T>(
  invalidate: (sources: SourceMask) => void,
  source: SourceMask,
  initialValue: T,
  assertWritable?: () => void,
): StateSlot<T> {
  let value = initialValue
  let revision = 0
  const token = {}

  const commit = (next: T): void => {
    if (Object.is(value, next)) return

    value = next
    revision += 1
    invalidate(source)
  }
  const commitUpdate = (update: StateUpdate<T>): void => {
    const next = typeof update === 'function' ? (update as (previous: T) => T)(value) : update
    commit(next)
  }
  const commitReplacement = (replacement: StateUpdate<T>): void => commit(replacement as T)
  const write = (update: StateUpdate<T>, commitWrite: (update: StateUpdate<T>) => void): void => {
    if (
      stateWriteInterceptor?.({
        slot: token,
        revision,
        update,
        commit: commitWrite,
        currentRevision: () => revision,
      })
    ) {
      return
    }
    commitWrite(update)
  }
  const replace = (next: T): void => {
    assertWritable?.()
    write(next, commitReplacement)
  }

  return {
    get: () => value,
    set: (update) => {
      assertWritable?.()
      write(update, commitUpdate)
    },
    replace,
  }
}
