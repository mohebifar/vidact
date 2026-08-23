import type { SourceMask } from './source-mask.ts'

export type StateUpdate<T> = T | ((previous: T) => T)

export interface StateSlot<T> {
  readonly get: () => T
  readonly set: (update: StateUpdate<T>) => void
}

export function createStateSlot<T>(
  invalidate: (sources: SourceMask) => void,
  source: SourceMask,
  initialValue: T,
): StateSlot<T> {
  let value = initialValue

  return {
    get: () => value,
    set: (update) => {
      const next = typeof update === 'function' ? (update as (previous: T) => T)(value) : update
      if (Object.is(value, next)) return

      value = next
      invalidate(source)
    },
  }
}
