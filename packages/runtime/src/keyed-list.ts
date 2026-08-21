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
  readonly update: (values: readonly T[]) => void
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
): KeyedList<T> {
  const start = document.createComment('vidact:list')
  const end = document.createComment('/vidact:list')
  parent.appendChild(start)
  parent.appendChild(end)

  let disposed = false
  let records: readonly RecordState<T, K>[] = []

  const update = (values: readonly T[]): void => {
    if (disposed) throw new Error('cannot update a disposed keyed list')

    const keys = values.map(options.key)
    assertUniqueKeys(keys)

    const previousByKey = new Map<K, RecordState<T, K>>()
    for (const record of records) previousByKey.set(record.key, record)
    const nextRecords = values.map((value, index): RecordState<T, K> => {
      const key = keys[index] as K
      const previous = previousByKey.get(key)
      if (previous !== undefined) {
        previousByKey.delete(key)
        previous.update?.(value, index)
        return previous
      }

      const item = normalizeRenderResult(options.render(value, index))
      return { key, ...item }
    })

    let cleanupFailed = false
    let firstCleanupError: unknown
    for (const removed of previousByKey.values()) {
      removeNodes(parent, removed.nodes)
      try {
        removed.dispose?.()
      } catch (error) {
        if (!cleanupFailed) {
          cleanupFailed = true
          firstCleanupError = error
        }
      }
    }

    let cursor: Node = end
    for (let recordIndex = nextRecords.length - 1; recordIndex >= 0; recordIndex -= 1) {
      const record = nextRecords[recordIndex] as RecordState<T, K>
      for (let nodeIndex = record.nodes.length - 1; nodeIndex >= 0; nodeIndex -= 1) {
        const node = record.nodes[nodeIndex] as Node
        if (node.nextSibling !== cursor) parent.insertBefore(node, cursor)
        cursor = node
      }
    }

    records = nextRecords
    if (cleanupFailed) throw firstCleanupError
  }

  const dispose = (): void => {
    if (disposed) return
    disposed = true
    let cleanupFailed = false
    let firstCleanupError: unknown
    for (const record of records) {
      removeNodes(parent, record.nodes)
      try {
        record.dispose?.()
      } catch (error) {
        if (!cleanupFailed) {
          cleanupFailed = true
          firstCleanupError = error
        }
      }
    }
    records = []
    start.remove()
    end.remove()
    if (cleanupFailed) throw firstCleanupError
  }

  return { dispose, update }
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
