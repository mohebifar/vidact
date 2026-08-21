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

type RenderValue = Node | string | number | bigint | boolean | null | undefined | readonly RenderValue[]

let activeOwner: Owner | null = null
const scopeOwners = new WeakMap<CompiledScope, Owner>()
const rootScopes = new WeakMap<Node, CompiledScope>()

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
      if (batchDepth === 0) flush()
    },
    batch<T>(operation: () => T): T {
      batchDepth += 1
      try {
        return operation()
      } finally {
        batchDepth -= 1
        if (batchDepth === 0) flush()
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
      if (branchOwner !== null) disposeOwner(branchOwner)
      removeBetween(start, end)
      branchOwner = null
      mounted = next
      if (!next) return

      branchOwner = createOwner()
      const value = withOwner(branchOwner, render)
      insertValue(parent, value, end)
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
      if (branchOwner !== null) disposeOwner(branchOwner)
      removeBetween(start, end)
      start.remove()
      end.remove()
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
          const rendered = withOwner(owner, () => {
            onCleanup(itemScope.dispose)
            return render(valueSlot, indexSlot, itemScope)
          })
          return {
            nodes: materialize(rendered),
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
    const update = (): void => list.update(values())
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

export function mountCompiled(component: () => Node, host: ParentNode): { dispose: () => void } {
  const root = component()
  const scope = rootScopes.get(root)
  const roots = root instanceof DocumentFragment ? [...root.childNodes] : [root]
  host.replaceChildren(root)
  return {
    dispose: () => {
      scope?.dispose()
      for (const mountedRoot of roots) {
        if (mountedRoot.parentNode === host) host.removeChild(mountedRoot)
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
  let current = toText(value.evaluate())
  const text = document.createTextNode(current)
  parent.appendChild(text)
  const removeUpdater = subscribe(value, () => {
      const next = toText(value.evaluate())
      if (next === current) return
      current = next
      text.data = next
  })
  onCleanup(removeUpdater)
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

function insertValue(parent: Node, value: RenderValue, before: Node | null): void {
  for (const node of materialize(value)) parent.insertBefore(node, before)
}

function materialize(value: RenderValue): Node[] {
  if (value === null || value === undefined || typeof value === 'boolean') return []
  if (Array.isArray(value)) return value.flatMap(materialize)
  if (value instanceof DocumentFragment) return [...value.childNodes]
  if (value instanceof Node) return [value]
  return [document.createTextNode(String(value))]
}

function removeBetween(start: Node, end: Node): void {
  let node = start.nextSibling
  while (node !== null && node !== end) {
    const next = node.nextSibling
    node.parentNode?.removeChild(node)
    node = next
  }
}

function toText(value: unknown): string {
  return value === null || value === undefined || typeof value === 'boolean' ? '' : String(value)
}
