import {
  intersectsSources,
  isEmptySources,
  source,
  unionSources,
  type SourceMask,
} from './source-mask.ts'
import { createStateSlot, type StateSlot } from './state-slot.ts'
import { createKeyedList } from './keyed-list.ts'

const MAX_FLUSH_PASSES = 100
const BINDING = Symbol('Vidact.Binding')
const STRUCTURAL = Symbol('Vidact.StructuralBinding')

interface Owner {
  disposed: boolean
  readonly cleanups: Set<() => void>
}

interface CompiledUpdater {
  readonly reads: SourceMask
  readonly writes?: SourceMask
  readonly run: (active: SourceMask) => void
  active: boolean
}

export interface CompiledScope {
  readonly add: (updater: Omit<CompiledUpdater, 'active'>) => () => void
  readonly batch: <T>(operation: () => T) => T
  readonly dispose: () => void
  readonly invalidate: (sources: SourceMask) => void
}

export interface CompiledBinding<T> {
  readonly [BINDING]: true
  readonly evaluate: () => T
  readonly reads: SourceMask
  readonly scope: CompiledScope
  readonly additional: CompiledDependency | undefined
}

export interface CompiledDependency {
  readonly reads: SourceMask
  readonly scope: CompiledScope
}

export interface OwnedBlock {
  readonly [STRUCTURAL]: true
  readonly mount: (parent: Node, before: Node | null) => void
}

export type StructuralBinding = OwnedBlock

type RenderValue =
  | Node
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined
  | CompiledBinding<unknown>
  | StructuralBinding
  | readonly RenderValue[]

type RefValue = ((value: Element | null) => void | (() => void)) | { current: unknown }

interface PendingRef {
  owner: Owner | null
  readonly value: RefValue
}

interface NodePosition {
  readonly node: Node
  readonly parent: Node | null
  readonly nextSibling: Node | null
}

let activeOwner: Owner | null = null
let activeScopeCollector: Set<CompiledScope> | null = null
let transactionDepth = 0
let drainingFlushes = false
const scheduledFlushes = new Set<() => void>()
const scopeOwners = new WeakMap<CompiledScope, Owner>()
const rootScopes = new WeakMap<Node, CompiledScope>()
const pendingRefs = new WeakMap<Element, PendingRef>()

export function createCompiledScope(): CompiledScope {
  const owner: Owner = { disposed: false, cleanups: new Set() }
  const updaters: Array<CompiledUpdater | undefined> = []
  const freeUpdaterIndexes: number[] = []
  const addedDuringFlush = new Set<CompiledUpdater>()
  let batchDepth = 0
  let flushing = false
  let pending: SourceMask = 0

  const flush = (): void => {
    if (owner.disposed || flushing) return
    flushing = true
    try {
      let pass = 0
      while (!isEmptySources(pending)) {
        pass += 1
        if (pass > MAX_FLUSH_PASSES) {
          pending = 0
          throw new Error('Vidact compiled scope did not stabilize')
        }

        let active = pending
        pending = 0
        const updaterCount = updaters.length
        for (let index = 0; index < updaterCount; index += 1) {
          const updater = updaters[index]
          if (
            updater === undefined
            || addedDuringFlush.has(updater)
            || !updater.active
            || !intersectsSources(active, updater.reads)
          ) {
            continue
          }
          updater.run(active)
          if (updater.writes !== undefined) active = unionSources(active, updater.writes)
        }
        addedDuringFlush.clear()
      }
    } finally {
      addedDuringFlush.clear()
      flushing = false
    }
  }

  const scope: CompiledScope = {
    add(updater) {
      if (owner.disposed) throw new Error('cannot add an updater to a disposed scope')
      const entry: CompiledUpdater = { ...updater, active: true }
      const reusableIndex = freeUpdaterIndexes.pop()
      const index = reusableIndex ?? updaters.length
      updaters[index] = entry
      if (flushing) addedDuringFlush.add(entry)
      const remove = (): void => {
        if (updaters[index] !== entry) return
        entry.active = false
        updaters[index] = undefined
        freeUpdaterIndexes.push(index)
      }
      if (activeOwner !== null && activeOwner !== owner) activeOwner.cleanups.add(remove)
      return remove
    },
    invalidate(sources) {
      if (owner.disposed || isEmptySources(sources)) return
      pending = unionSources(pending, sources)
      if (batchDepth === 0) scheduleFlush(flush)
    },
    batch<T>(operation: () => T): T {
      batchDepth += 1
      transactionDepth += 1
      try {
        return operation()
      } finally {
        batchDepth -= 1
        if (batchDepth === 0 && !isEmptySources(pending)) scheduleFlush(flush)
        transactionDepth -= 1
        if (transactionDepth === 0) drainFlushes()
      }
    },
    dispose() {
      if (owner.disposed) return
      try {
        disposeOwner(owner)
      } finally {
        pending = 0
        for (const updater of updaters) {
          if (updater !== undefined) updater.active = false
        }
        updaters.length = 0
        freeUpdaterIndexes.length = 0
        addedDuringFlush.clear()
      }
    },
  }
  scopeOwners.set(scope, owner)
  activeScopeCollector?.add(scope)
  return scope
}

export function createCompiledState<T>(
  scope: CompiledScope,
  source: SourceMask,
  initialValue: T | (() => T),
): StateSlot<T> {
  const value = typeof initialValue === 'function'
    ? (initialValue as () => T)()
    : initialValue
  return createStateSlot(scope, source, value)
}

export function createCompiledProp<T>(
  scope: CompiledScope,
  source: SourceMask,
  input: T | CompiledBinding<T>,
  fallback?: () => T,
): StateSlot<T> {
  const upstream = isCompiledBinding(input) ? input : undefined
  const read = (): T => {
    const value = upstream === undefined ? input as T : upstream.evaluate()
    return value === undefined && fallback !== undefined ? fallback() : value
  }
  const slot = createStateSlot<T>(
    scope,
    source,
    read(),
  )
  if (upstream !== undefined) {
    const remove = subscribe(upstream, () => slot.set(read()))
    const owner = scopeOwners.get(scope)
    if (owner === undefined) throw new Error('createCompiledProp received an unknown scope')
    owner.cleanups.add(remove)
  }
  return slot
}

export function binding<T>(
  scope: CompiledScope,
  reads: SourceMask,
  evaluate: () => T,
  additionalScope?: CompiledScope,
  additionalReads?: SourceMask,
): CompiledBinding<T> {
  const additional = additionalScope === undefined || additionalReads === undefined
    ? undefined
    : { scope: additionalScope, reads: additionalReads }
  return { [BINDING]: true, evaluate, reads, scope, additional }
}

export function compiledEvent<T extends Event>(
  scope: CompiledScope,
  handler: (event: T) => void,
): (event: T) => void {
  return (event) => scope.batch(() => handler(event))
}

export function when(
  scope: CompiledScope,
  reads: SourceMask,
  condition: () => unknown,
  render: () => RenderValue,
  additionalScope?: CompiledScope,
  additionalReads?: SourceMask,
): StructuralBinding {
  return structural((parent, before) => {
    const start = document.createComment('vidact:when')
    const end = document.createComment('/vidact:when')
    parent.insertBefore(start, before)
    parent.insertBefore(end, before)
    let branchOwner: Owner | null = null
    let mounted = false

    const update = (): void => {
      const next = Boolean(condition())
      if (next === mounted) return
      const currentParent = rangeParent(start, end, 'conditional block')
      if (!next) {
        const owner = branchOwner
        branchOwner = null
        mounted = false
        disposeRange(owner, start, end)
        return
      }

      const nextOwner = createOwner()
      const { fragment, nodes: staged } = stageValue(render(), nextOwner)
      currentParent.insertBefore(fragment, end)
      for (const node of staged) commitPendingRefs(node)
      branchOwner = nextOwner
      mounted = true
    }

    update()
    const removeUpdater = subscribe(
      { scope, reads, additional: additionalScope === undefined || additionalReads === undefined
        ? undefined
        : { scope: additionalScope, reads: additionalReads } },
      update,
    )
    onCleanup(() => {
      removeUpdater()
      try {
        disposeRange(branchOwner, start, end)
      } finally {
        start.remove()
        end.remove()
      }
    })
  })
}

export function keyed<T, K>(
  scope: CompiledScope,
  reads: SourceMask,
  values: () => readonly T[],
  key: (value: T, index: number) => K,
  render: (
    value: StateSlot<T>,
    index: StateSlot<number>,
    itemScope: CompiledScope,
  ) => RenderValue,
): StructuralBinding {
  return structural((parent, before) => {
    const itemSource = source(0)
    const indexSource = source(1)
    const list = createKeyedList(parent, {
      key,
      render(value, index) {
        const owner = createOwner()
        const itemScope = createCompiledScope()
        const valueSlot = createCompiledState(itemScope, itemSource, value)
        const indexSlot = createCompiledState(itemScope, indexSource, index)
        try {
          const nodes = withOwner(owner, () => {
            onCleanup(itemScope.dispose)
            return materialize(render(valueSlot, indexSlot, itemScope))
          })
          return {
            nodes,
            update(nextValue: T, nextIndex: number) {
              itemScope.batch(() => {
                valueSlot.set(nextValue)
                indexSlot.set(nextIndex)
              })
            },
            dispose: () => disposeOwner(owner),
          }
        } catch (error) {
          disposeOwner(owner)
          itemScope.dispose()
          throw error
        }
      },
    }, before)
    const update = (): void => {
      try {
        for (const node of list.update(values())) commitPendingRefs(node)
      } catch (error) {
        const currentParent = list.parent()
        if (currentParent !== null) commitPendingRefs(currentParent)
        throw error
      }
    }
    update()
    const removeUpdater = scope.add({ reads, run: update })
    onCleanup(() => {
      removeUpdater()
      list.dispose()
    })
  })
}

export function compiledRoot(scope: CompiledScope, render: () => Node): Node {
  const owner = scopeOwners.get(scope)
  if (owner === undefined) throw new Error('compiledRoot received an unknown scope')
  const root = withOwner(owner, render)
  rootScopes.set(root, scope)
  return root
}

export function adoptCompiledRoot(root: Node): void {
  const scope = rootScopes.get(root)
  if (scope === undefined) return
  const owner = scopeOwners.get(scope)
  if (activeOwner !== null && owner !== undefined && activeOwner !== owner) {
    activeOwner.cleanups.add(scope.dispose)
  }
}

export function constructCompiledComponent(component: () => Node): Node {
  const previousCollector = activeScopeCollector
  const scopes = new Set<CompiledScope>()
  activeScopeCollector = scopes
  try {
    return component()
  } catch (error) {
    for (const scope of [...scopes].reverse()) {
      try {
        scope.dispose()
      } catch {
        // Preserve the construction error that made this component unmountable.
      }
    }
    throw error
  } finally {
    activeScopeCollector = previousCollector
  }
}

export function queueElementRef(element: Element, value: unknown): void {
  if (!isRefValue(value)) throw new TypeError('ref must be a callback or an object with current')
  pendingRefs.set(element, { owner: activeOwner, value })
}

export function mountCompiled(component: () => Node, host: ParentNode): { dispose: () => void } {
  const root = constructCompiledComponent(component)
  const scope = rootScopes.get(root)
  const roots = root instanceof DocumentFragment ? [...root.childNodes] : [root]
  host.replaceChildren(root)
  for (const mountedRoot of roots) commitPendingRefs(mountedRoot)
  return {
    dispose: () => {
      try {
        scope?.dispose()
      } finally {
        for (const mountedRoot of roots) {
          if (mountedRoot.parentNode === host) host.removeChild(mountedRoot)
        }
      }
    },
  }
}

export function isCompiledBinding(value: unknown): value is CompiledBinding<unknown> {
  return typeof value === 'object' && value !== null && BINDING in value
}

export function isStructuralBinding(value: unknown): value is StructuralBinding {
  return typeof value === 'object' && value !== null && STRUCTURAL in value
}

export function mountCompiledBinding(parent: Node, value: CompiledBinding<unknown>): void {
  mountCompiledBindingBefore(parent, value, null)
}

export function mountCompiledProp(
  value: CompiledBinding<unknown>,
  apply: (next: unknown) => void,
): void {
  let current = value.evaluate()
  apply(current)
  const removeUpdater = subscribe(value, () => {
      const next = value.evaluate()
      if (Object.is(next, current)) return
      current = next
      apply(next)
  })
  onCleanup(removeUpdater)
}

function structural(mount: StructuralBinding['mount']): StructuralBinding {
  let mounted = false
  return {
    [STRUCTURAL]: true,
    mount(parent, before) {
      if (mounted) throw new Error('compiled block is already mounted')
      mounted = true
      mount(parent, before)
    },
  }
}

function subscribe(
  dependency: CompiledDependency & { readonly additional: CompiledDependency | undefined },
  run: () => void,
): () => void {
  const removers = [dependency, dependency.additional]
    .filter((item): item is CompiledDependency => item !== undefined && !isEmptySources(item.reads))
    .map((item) => item.scope.add({ reads: item.reads, run }))
  return () => {
    for (const remove of removers) remove()
  }
}

function createOwner(): Owner {
  return { disposed: false, cleanups: new Set() }
}

function withOwner<T>(owner: Owner, operation: () => T): T {
  const previous = activeOwner
  activeOwner = owner
  try {
    return operation()
  } finally {
    activeOwner = previous
  }
}

function onCleanup(cleanup: () => void): void {
  activeOwner?.cleanups.add(cleanup)
}

function disposeOwner(owner: Owner): void {
  if (owner.disposed) return
  owner.disposed = true
  const cleanups = [...owner.cleanups]
  owner.cleanups.clear()
  let firstError: unknown
  let hasError = false
  for (let index = cleanups.length - 1; index >= 0; index -= 1) {
    try {
      cleanups[index]?.()
    } catch (error) {
      if (!hasError) firstError = error
      hasError = true
    }
  }
  if (hasError) throw firstError
}

function mountCompiledBindingBefore(
  parent: Node,
  value: CompiledBinding<unknown>,
  before: Node | null,
): void {
  const start = document.createComment('vidact:binding')
  const end = document.createComment('/vidact:binding')
  parent.insertBefore(start, before)
  parent.insertBefore(end, before)
  const unset = Symbol('Vidact.UnsetBinding')
  let current: unknown = unset
  let currentOwner: Owner | null = null
  let text: Text | null = null

  const clear = (): void => {
    const owner = currentOwner
    currentOwner = null
    text = null
    disposeRange(owner, start, end)
  }
  const update = (): void => {
    const next = value.evaluate()
    if (current !== unset && Object.is(next, current)) return
    const currentParent = rangeParent(start, end, 'binding range')

    if (isScalarRenderValue(next)) {
      const content = toText(next)
      if (text !== null) {
        if (text.data !== content) text.data = content
        current = next
        return
      }
      clear()
      text = document.createTextNode(content)
      currentParent.insertBefore(text, end)
      current = next
      return
    }

    const nextOwner = createOwner()
    const { fragment, nodes: staged } = stageValue(next as RenderValue, nextOwner)
    try {
      clear()
    } catch (error) {
      disposeOwner(nextOwner)
      throw error
    }
    currentOwner = nextOwner
    currentParent.insertBefore(fragment, end)
    for (const node of staged) commitPendingRefs(node)
    current = next
  }

  update()
  const removeUpdater = subscribe(value, update)
  onCleanup(() => {
    removeUpdater()
    clear()
    start.remove()
    end.remove()
  })
}

function materialize(value: RenderValue): Node[] {
  const fragment = document.createDocumentFragment()
  const moves: NodePosition[] = []
  try {
    insertValue(fragment, value, null, moves)
  } catch (error) {
    restoreNodePositions(moves)
    throw error
  }
  return [...fragment.childNodes]
}

function stageValue(
  value: RenderValue,
  owner: Owner,
): { readonly fragment: DocumentFragment; readonly nodes: readonly Node[] } {
  const fragment = document.createDocumentFragment()
  const moves: NodePosition[] = []
  try {
    withOwner(owner, () => insertValue(fragment, value, null, moves))
  } catch (error) {
    restoreNodePositions(moves)
    try {
      disposeOwner(owner)
    } catch {
      // Preserve the staging error; cleanup still ran every registered disposer.
    }
    throw error
  }
  return { fragment, nodes: [...fragment.childNodes] }
}

function insertValue(
  parent: Node,
  value: RenderValue,
  before: Node | null,
  moves?: NodePosition[],
): void {
  if (value === null || value === undefined || typeof value === 'boolean') return
  if (isStructuralBinding(value)) {
    value.mount(parent, before)
    return
  }
  if (isCompiledBinding(value)) {
    mountCompiledBindingBefore(parent, value, before)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) insertValue(parent, item, before, moves)
    return
  }
  if (value instanceof DocumentFragment) {
    for (const child of [...value.childNodes]) insertValue(parent, child, before, moves)
    return
  }
  if (value instanceof Node) {
    moves?.push({ node: value, parent: value.parentNode, nextSibling: value.nextSibling })
    adoptCompiledRoot(value)
    claimPendingRefOwners(value)
    parent.insertBefore(value, before)
    if (!(parent instanceof DocumentFragment)) commitPendingRefs(value)
    return
  }
  if (typeof value === 'object' || typeof value === 'function' || typeof value === 'symbol') {
    throw new TypeError('unsupported compiled child value; expected a DOM node or owned block')
  }
  parent.insertBefore(document.createTextNode(String(value)), before)
}

function restoreNodePositions(positions: readonly NodePosition[]): void {
  for (let index = positions.length - 1; index >= 0; index -= 1) {
    const position = positions[index]
    if (position === undefined) continue
    if (position.parent === null) {
      position.node.parentNode?.removeChild(position.node)
      continue
    }
    const before = position.nextSibling?.parentNode === position.parent
      ? position.nextSibling
      : null
    position.parent.insertBefore(position.node, before)
  }
}

function removeBetween(start: Node, end: Node): void {
  let node = start.nextSibling
  while (node !== null && node !== end) {
    const next = node.nextSibling
    node.parentNode?.removeChild(node)
    node = next
  }
}

function rangeParent(start: Node, end: Node, description: string): Node {
  const parent = end.parentNode
  if (parent === null || start.parentNode !== parent) {
    throw new Error(`cannot update a detached ${description}`)
  }
  return parent
}

function disposeRange(owner: Owner | null, start: Node, end: Node): void {
  try {
    if (owner !== null) disposeOwner(owner)
  } finally {
    removeBetween(start, end)
  }
}

function toText(value: unknown): string {
  return value === null || value === undefined || typeof value === 'boolean' ? '' : String(value)
}

function isScalarRenderValue(
  value: unknown,
): value is string | number | bigint | boolean | null | undefined {
  return value === null
    || value === undefined
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'bigint'
    || typeof value === 'boolean'
}

function isRefValue(value: unknown): value is RefValue {
  return typeof value === 'function'
    || (typeof value === 'object' && value !== null && 'current' in value)
}

function claimPendingRefOwners(root: Node): void {
  visitElements(root, (element) => {
    const pending = pendingRefs.get(element)
    if (pending !== undefined && pending.owner === null) pending.owner = activeOwner
  })
}

function commitPendingRefs(root: Node): void {
  visitElements(root, (element) => {
    const pending = pendingRefs.get(element)
    if (pending === undefined) return
    pendingRefs.delete(element)
    const owner = pending.owner ?? activeOwner
    const cleanup = attachRef(pending.value, element)
    owner?.cleanups.add(cleanup)
  })
}

function visitElements(root: Node, visit: (element: Element) => void): void {
  if (root instanceof Element) visit(root)
  for (const child of root.childNodes) visitElements(child, visit)
}

function attachRef(value: RefValue, element: Element): () => void {
  if (typeof value === 'function') {
    const cleanup = value(element)
    return typeof cleanup === 'function' ? cleanup : () => value(null)
  }
  value.current = element
  return () => {
    if (value.current === element) value.current = null
  }
}

function scheduleFlush(flush: () => void): void {
  scheduledFlushes.add(flush)
  if (transactionDepth === 0) drainFlushes()
}

function drainFlushes(): void {
  if (drainingFlushes || transactionDepth > 0) return
  drainingFlushes = true
  const runs = new Map<() => void, number>()
  try {
    while (scheduledFlushes.size > 0) {
      const flush = scheduledFlushes.values().next().value
      if (flush === undefined) break
      scheduledFlushes.delete(flush)
      const runCount = (runs.get(flush) ?? 0) + 1
      if (runCount > MAX_FLUSH_PASSES) {
        scheduledFlushes.clear()
        throw new Error('Vidact compiled scopes did not stabilize')
      }
      runs.set(flush, runCount)
      flush()
    }
  } finally {
    drainingFlushes = false
  }
}
