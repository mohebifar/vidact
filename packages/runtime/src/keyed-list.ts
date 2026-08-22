export interface KeyedItem<T> {
  readonly nodes: readonly Node[]
  readonly update?: (value: T, index: number) => void
  readonly dispose?: () => void
}

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

interface RecordState<T, K> {
  readonly key: K
  readonly nodes: readonly Node[]
  readonly update?: (value: T, index: number) => void
  readonly dispose?: () => void
}

export function createKeyedList<T, K>(
  parent: Node,
  options: KeyedListOptions<T, K>,
  before: Node | null = null,
): KeyedList<T> {
  const start = document.createComment('vidact:list')
  const end = document.createComment('/vidact:list')
  parent.insertBefore(start, before)
  parent.insertBefore(end, before)

  let disposed = false
  let records: readonly RecordState<T, K>[] = []

  const update = (values: readonly T[]): readonly Node[] => {
    if (disposed) throw new Error('cannot update a disposed keyed list')
    const currentParent = end.parentNode
    if (currentParent === null || start.parentNode !== currentParent) {
      throw new Error('cannot update a detached keyed list')
    }

    const keys = values.map(options.key)
    assertUniqueKeys(keys)

    const previousByKey = new Map<K, RecordState<T, K>>()
    for (const record of records) previousByKey.set(record.key, record)
    const created: RecordState<T, K>[] = []
    const retained: Array<{ record: RecordState<T, K>; value: T; index: number }> = []
    let nextRecords: RecordState<T, K>[]
    try {
      nextRecords = values.map((value, index): RecordState<T, K> => {
        const key = keys[index] as K
        const previous = previousByKey.get(key)
        if (previous !== undefined) {
          previousByKey.delete(key)
          retained.push({ record: previous, value, index })
          return previous
        }

        const item = normalizeRenderResult(options.render(value, index))
        const record = { key, ...item }
        created.push(record)
        return record
      })
      for (const { record, value, index } of retained) record.update?.(value, index)
    } catch (error) {
      disposeRecords(currentParent, created)
      throw error
    }

    const cleanup = disposeRecords(currentParent, previousByKey.values())

    let cursor: Node = end
    for (let recordIndex = nextRecords.length - 1; recordIndex >= 0; recordIndex -= 1) {
      const record = nextRecords[recordIndex] as RecordState<T, K>
      for (let nodeIndex = record.nodes.length - 1; nodeIndex >= 0; nodeIndex -= 1) {
        const node = record.nodes[nodeIndex] as Node
        if (node.nextSibling !== cursor) currentParent.insertBefore(node, cursor)
        cursor = node
      }
    }

    records = nextRecords
    if (cleanup.failed) throw cleanup.error
    return created.flatMap((record) => record.nodes)
  }

  const dispose = (): void => {
    if (disposed) return
    disposed = true
    const currentParent = end.parentNode
    const cleanup =
      currentParent === null
        ? { error: undefined, failed: false }
        : disposeRecords(currentParent, records)
    records = []
    start.remove()
    end.remove()
    if (cleanup.failed) throw cleanup.error
  }

  return { dispose, parent: () => end.parentNode, update }
}

function assertUniqueKeys<K>(keys: readonly K[]): void {
  const seen = new Set<K>()
  for (const key of keys) {
    if (seen.has(key)) throw new Error(`duplicate key in keyed list: ${String(key)}`)
    seen.add(key)
  }
}

function normalizeRenderResult<T>(result: KeyedRenderResult<T>): KeyedItem<T> {
  if (isNode(result)) return { nodes: normalizeNodes([result]) }
  if (isNodeArray(result)) return { nodes: normalizeNodes(result) }
  return {
    nodes: normalizeNodes(result.nodes),
    ...(result.update === undefined ? {} : { update: result.update }),
    ...(result.dispose === undefined ? {} : { dispose: result.dispose }),
  }
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
  return normalized.length === 0 ? [document.createComment('vidact:empty')] : normalized
}

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && 'nodeType' in value
}

function isNodeArray<T>(value: KeyedRenderResult<T>): value is readonly Node[] {
  return Array.isArray(value)
}

function removeNodes(parent: Node, nodes: readonly Node[]): void {
  for (const node of nodes) {
    if (node.parentNode === parent) parent.removeChild(node)
  }
}

function disposeRecords<T, K>(
  parent: Node,
  records: Iterable<RecordState<T, K>>,
): { readonly error: unknown; readonly failed: boolean } {
  let firstError: unknown
  let failed = false
  for (const record of records) {
    removeNodes(parent, record.nodes)
    try {
      record.dispose?.()
    } catch (error) {
      if (!failed) firstError = error
      failed = true
    }
  }
  return { error: firstError, failed }
}
