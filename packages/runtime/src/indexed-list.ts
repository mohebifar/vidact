import { createKeyedList, type KeyedList, type KeyedRenderResult } from './keyed-list.ts'

export interface IndexedListOptions<T> {
  readonly render: (value: T, index: number) => KeyedRenderResult<T>
}

export type IndexedList<T> = KeyedList<T>

/**
 * Reconciles records by their current position. Existing owners are retained at
 * an index and receive the new value at that index, matching React's unkeyed
 * collection identity semantics.
 */
export function createIndexedList<T>(
  parent: Node,
  options: IndexedListOptions<T>,
  before: Node | null = null,
): IndexedList<T> {
  return createKeyedList(parent, { key: (_value, index) => index, render: options.render }, before)
}
