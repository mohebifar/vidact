export type KeyedItem<T> = readonly [
  nodes: readonly Node[],
  update?: ((value: T, index: number) => void) | undefined,
  dispose?: (() => void) | undefined,
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
  dispose: (() => void) | undefined,
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

    const previousByKey = new Map<K, RecordState<T, K>>()
    for (const record of records) previousByKey.set(record[0], record)
    const created: RecordState<T, K>[] = []
    const retained: Array<readonly [RecordState<T, K>, T, number]> = []
    let nextRecords: RecordState<T, K>[]
    try {
      nextRecords = values.map((value, index): RecordState<T, K> => {
        const key = keys[index] as K
        const previous = previousByKey.get(key)
        if (previous !== undefined) {
          previousByKey.delete(key)
          retained.push([previous, value, index])
          return previous
        }

        const item = normalizeRenderResult(
          withHydrationInsertion(parent, end, () => options.render(value, index)),
        )
        const record: RecordState<T, K> = [key, item[0], item[1], item[2]]
        created.push(record)
        return record
      })
      for (const [record, value, index] of retained) record[2]?.(value, index)
    } catch (error) {
      disposeRecords(currentParent, created)
      throw error
    }

    const cleanup = disposeRecords(currentParent, previousByKey.values())

    const activeElement =
      document.activeElement instanceof HTMLElement &&
      currentParent.contains(document.activeElement)
        ? document.activeElement
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
      for (let nodeIndex = record[1].length - 1; nodeIndex >= 0; nodeIndex -= 1) {
        const node = record[1][nodeIndex] as Node
        if (node.nextSibling !== cursor) moveBefore(currentParent, node, cursor)
        cursor = node
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
    return created.flatMap((record) => record[1])
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
  const normalized: Node[] = []
  for (const node of nodes) {
    if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
      normalized.push(...node.childNodes)
    } else {
      normalized.push(node)
    }
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
      record[3]?.()
    } catch (error) {
      if (!failed) firstError = error
      failed = true
    }
  }
  return [firstError, failed]
}
import {
  claimHydrationArrayRange,
  finishHydrationArrayRange,
  withHydrationInsertion,
} from './hydration.ts'
