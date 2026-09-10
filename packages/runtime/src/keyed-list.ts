export interface KeyedDisposeTarget {
  readonly [3]: () => void
}

export type KeyedDisposer = (() => void) | KeyedDisposeTarget

export type KeyedItem<T> = readonly [
  nodes: readonly Node[],
  update?: ((value: T, index: number) => void) | undefined,
  dispose?: KeyedDisposer | undefined,
]

export type KeyedRenderResult<T> = Node | readonly Node[] | KeyedItem<T>

export interface KeyedListOptions<T, K> {
  readonly key: (value: T, index: number) => K
  readonly render: (value: T, index: number) => KeyedRenderResult<T>
}

export interface KeyedList<T> {
  readonly dispose: () => void
  readonly parent: () => Node | null
  readonly update: (values: readonly T[]) => readonly Node[]
}

type RecordState<T, K> = readonly [
  key: K,
  nodes: readonly Node[],
  update: ((value: T, index: number) => void) | undefined,
  dispose: KeyedDisposer | undefined,
]

const DEV = typeof __VIDACT_DEV__ === 'undefined' || __VIDACT_DEV__

export function createKeyedList<T, K>(
  parent: Node,
  options: KeyedListOptions<T, K>,
  before: Node | null = null,
): KeyedList<T> {
  const hydratedRange = claimHydrationArrayRange(parent)
  const start = hydratedRange?.[0] ?? document.createComment(DEV ? 'vidact:list' : '')
  const end = hydratedRange?.[1] ?? document.createComment(DEV ? '/vidact:list' : '')
  if (hydratedRange === undefined) {
    parent.insertBefore(start, before)
    parent.insertBefore(end, before)
  }

  let disposed = false
  let hydrationPending = hydratedRange !== undefined
  let records: readonly RecordState<T, K>[] = []

  const update = (values: readonly T[]): readonly Node[] => {
    if (disposed) throw new Error(DEV ? 'cannot update a disposed keyed list' : 'V801')
    const currentParent = end.parentNode
    if (currentParent === null || start.parentNode !== currentParent) {
      throw new Error(DEV ? 'cannot update a detached keyed list' : 'V802')
    }

    const keys = values.map(options.key)
    assertValidKeys(keys)
    assertUniqueKeys(keys)

    if (!hydrationPending && values.length === 0 && records.length > 0) {
      const removed = records
      records = []
      deleteRangeContents(start, end)
      const cleanup = disposeRecordOwners(removed)
      if (cleanup[1]) throw cleanup[0]
      return []
    }

    if (!hydrationPending && hasRetainedPrefix(records, keys)) {
      const retainedCount = Math.min(records.length, values.length)
      const created: RecordState<T, K>[] = []
      try {
        for (let index = records.length; index < values.length; index += 1) {
          const value = values[index] as T
          const item = normalizeRenderResult(
            withHydrationInsertion(parent, end, () => options.render(value, index)),
          )
          created.push([keys[index] as K, item[0], item[1], item[2]])
        }
        for (let index = 0; index < retainedCount; index += 1) {
          records[index]![2]?.(values[index] as T, index)
        }
      } catch (error) {
        disposeRecords(currentParent, created)
        throw error
      }

      const cleanup = disposeRecords(currentParent, records.slice(values.length))
      const fragment = document.createDocumentFragment()
      for (const record of created) {
        for (const node of record[1]) fragment.append(node)
      }
      currentParent.insertBefore(fragment, end)
      if (records.length !== values.length) {
        records = retainedCount === 0 ? created : [...records.slice(0, retainedCount), ...created]
      }
      if (cleanup[1]) throw cleanup[0]
      return collectRecordNodes(created)
    }

    const previousByKey = new Map<K, readonly [record: RecordState<T, K>, index: number]>()
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index] as RecordState<T, K>
      previousByKey.set(record[0], [record, index])
    }
    const created: RecordState<T, K>[] = []
    const retained: Array<readonly [RecordState<T, K>, T, number]> = []
    const previousIndexes: number[] = []
    let nextRecords: RecordState<T, K>[]
    try {
      nextRecords = values.map((value, index): RecordState<T, K> => {
        const key = keys[index] as K
        const previous = previousByKey.get(key)
        if (previous !== undefined) {
          previousByKey.delete(key)
          retained.push([previous[0], value, index])
          previousIndexes.push(previous[1])
          return previous[0]
        }

        const item = normalizeRenderResult(
          withHydrationInsertion(parent, end, () => options.render(value, index)),
        )
        const record: RecordState<T, K> = [key, item[0], item[1], item[2]]
        created.push(record)
        previousIndexes.push(-1)
        return record
      })
      for (const [record, value, index] of retained) record[2]?.(value, index)
    } catch (error) {
      disposeRecords(currentParent, created)
      throw error
    }

    const cleanup = disposeRecords(currentParent, mapRecords(previousByKey.values()))

    const stableRecords = longestIncreasingSubsequence(previousIndexes)
    const hasRetainedMoves = previousIndexes.some(
      (previousIndex, index) => previousIndex >= 0 && stableRecords[index] === 0,
    )
    const activeElement = hasRetainedMoves
      ? document.activeElement instanceof HTMLElement &&
        currentParent.contains(document.activeElement)
        ? document.activeElement
        : null
      : null
    const selectionControl =
      activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement
        ? activeElement
        : null
    const selection =
      selectionControl === null
        ? null
        : ([selectionControl.selectionStart, selectionControl.selectionEnd] as const)
    let cursor: Node = end
    for (let recordIndex = nextRecords.length - 1; recordIndex >= 0; recordIndex -= 1) {
      const record = nextRecords[recordIndex] as RecordState<T, K>
      if (previousIndexes[recordIndex] === -1 || stableRecords[recordIndex] === 0) {
        for (let nodeIndex = record[1].length - 1; nodeIndex >= 0; nodeIndex -= 1) {
          const node = record[1][nodeIndex] as Node
          if (node.nextSibling !== cursor) moveBefore(currentParent, node, cursor)
          cursor = node
        }
      } else {
        cursor = record[1][0] as Node
      }
    }
    if (
      activeElement !== null &&
      document.activeElement !== activeElement &&
      currentParent.contains(activeElement)
    ) {
      activeElement.focus({ preventScroll: true })
      if (
        selectionControl !== null &&
        selection !== null &&
        selection[0] !== null &&
        selection[1] !== null
      ) {
        selectionControl.setSelectionRange(selection[0], selection[1])
      }
    }

    records = nextRecords
    if (hydrationPending) {
      hydrationPending = false
      finishHydrationArrayRange(currentParent, end)
    }
    if (cleanup[1]) throw cleanup[0]
    return collectRecordNodes(created)
  }

  const dispose = (): void => {
    if (disposed) return
    disposed = true
    const currentParent = end.parentNode
    const cleanup =
      currentParent === null
        ? ([undefined, false] as const)
        : disposeRecords(currentParent, records)
    records = []
    start.remove()
    end.remove()
    if (cleanup[1]) throw cleanup[0]
  }

  return { dispose, parent: () => end.parentNode, update }
}

function* mapRecords<T, K>(
  entries: Iterable<readonly [record: RecordState<T, K>, index: number]>,
): Iterable<RecordState<T, K>> {
  for (const [record] of entries) yield record
}

function collectRecordNodes<T, K>(records: readonly RecordState<T, K>[]): Node[] {
  const nodes: Node[] = []
  for (const record of records) nodes.push(...record[1])
  return nodes
}

function longestIncreasingSubsequence(indexes: readonly number[]): Uint8Array {
  const predecessors = new Int32Array(indexes.length).fill(-1)
  const tails: number[] = []
  for (let index = 0; index < indexes.length; index += 1) {
    const value = indexes[index] as number
    if (value < 0) continue
    let low = 0
    let high = tails.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if ((indexes[tails[middle] as number] as number) < value) low = middle + 1
      else high = middle
    }
    if (low > 0) predecessors[index] = tails[low - 1] as number
    tails[low] = index
  }

  const stable = new Uint8Array(indexes.length)
  let index = tails.at(-1) ?? -1
  while (index >= 0) {
    stable[index] = 1
    index = predecessors[index] as number
  }
  return stable
}

function hasRetainedPrefix<T, K>(
  records: readonly RecordState<T, K>[],
  keys: readonly K[],
): boolean {
  const retainedCount = Math.min(records.length, keys.length)
  for (let index = 0; index < retainedCount; index += 1) {
    if (records[index]![0] !== keys[index]) return false
  }
  return true
}

function moveBefore(parent: Node, node: Node, before: Node): void {
  const statePreservingParent = parent as Node & {
    moveBefore?: (node: Node, before: Node | null) => void
  }
  if (statePreservingParent.moveBefore !== undefined && node.parentNode === parent) {
    statePreservingParent.moveBefore(node, before)
  } else {
    parent.insertBefore(node, before)
  }
}

function assertValidKeys<K>(keys: readonly K[]): void {
  for (const key of keys) {
    if (typeof key !== 'string' && typeof key !== 'number' && typeof key !== 'bigint') {
      throw new Error(DEV ? `invalid key in keyed list: ${String(key)}` : 'V803')
    }
  }
}

function assertUniqueKeys<K>(keys: readonly K[]): void {
  const seen = new Set<K>()
  for (const key of keys) {
    if (seen.has(key)) {
      throw new Error(DEV ? `duplicate key in keyed list: ${String(key)}` : 'V804')
    }
    seen.add(key)
  }
}

function normalizeRenderResult<T>(result: KeyedRenderResult<T>): KeyedItem<T> {
  if (isNode(result)) return [normalizeNodes([result])]
  if (isNodeArray(result)) return [normalizeNodes(result)]
  return [normalizeNodes(result[0]), result[1], result[2]]
}

function normalizeNodes(nodes: readonly Node[]): readonly Node[] {
  if (nodes.length === 0) return [document.createComment(DEV ? 'vidact:empty' : '')]
  let firstFragment = -1
  for (let index = 0; index < nodes.length; index += 1) {
    if (nodes[index]!.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
      firstFragment = index
      break
    }
  }
  if (firstFragment === -1) return nodes
  const normalized = nodes.slice(0, firstFragment) as Node[]
  for (let index = firstFragment; index < nodes.length; index += 1) {
    const node = nodes[index]!
    if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) normalized.push(...node.childNodes)
    else normalized.push(node)
  }
  return normalized.length === 0 ? [document.createComment(DEV ? 'vidact:empty' : '')] : normalized
}

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && 'nodeType' in value
}

function isNodeArray<T>(value: KeyedRenderResult<T>): value is readonly Node[] {
  return Array.isArray(value) && (value.length === 0 || isNode(value[0]))
}

function removeNodes(parent: Node, nodes: readonly Node[]): void {
  for (const node of nodes) {
    if (node.parentNode === parent) parent.removeChild(node)
  }
}

function disposeRecords<T, K>(
  parent: Node,
  records: Iterable<RecordState<T, K>>,
): readonly [error: unknown, failed: boolean] {
  let firstError: unknown
  let failed = false
  for (const record of records) {
    removeNodes(parent, record[1])
    try {
      disposeRecord(record[3])
    } catch (error) {
      if (!failed) firstError = error
      failed = true
    }
  }
  return [firstError, failed]
}

function disposeRecordOwners<T, K>(
  records: Iterable<RecordState<T, K>>,
): readonly [error: unknown, failed: boolean] {
  let firstError: unknown
  let failed = false
  for (const record of records) {
    try {
      disposeRecord(record[3])
    } catch (error) {
      if (!failed) firstError = error
      failed = true
    }
  }
  return [firstError, failed]
}

function disposeRecord(disposer: KeyedDisposer | undefined): void {
  if (typeof disposer === 'function') disposer()
  else disposer?.[3]()
}

function deleteRangeContents(start: Node, end: Node): void {
  const range = start.ownerDocument?.createRange() ?? document.createRange()
  range.setStartAfter(start)
  range.setEndBefore(end)
  range.deleteContents()
}
import {
  claimHydrationArrayRange,
  finishHydrationArrayRange,
  withHydrationInsertion,
} from './hydration-bridge.ts'
