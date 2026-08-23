import {
  currentIntrinsicNamespace,
  withIntrinsicNamespace,
  type IntrinsicNamespace,
} from './dom/namespace.ts'
import { createIndexedList } from './indexed-list.ts'
import { createKeyedList } from './keyed-list.ts'
import { intersectsSources, isEmptySources, unionSources, type SourceMask } from './source-mask.ts'
import { createStateSlot, type StateSlot } from './state-slot.ts'

const MAX_FLUSH_PASSES = 100
const DEV = typeof __VIDACT_DEV__ === 'undefined' || __VIDACT_DEV__
const BINDING = Symbol(DEV ? 'Vidact.Binding' : undefined)
const STRUCTURAL = Symbol(DEV ? 'Vidact.StructuralBinding' : undefined)
const CONTEXT = Symbol(DEV ? 'Vidact.Context' : undefined)
export const COMPONENT_SPREAD_SOURCE = Symbol(DEV ? 'Vidact.ComponentSpreadSource' : undefined)

type ContextFrame = {
  readonly context: CompiledContext<unknown>
  readonly input: unknown
  readonly parent: ContextFrame | null
}

type Owner = [disposed: boolean, cleanups: Set<() => void>, context: ContextFrame | null]

type CompiledUpdater = [
  reads: SourceMask,
  writes: SourceMask | undefined,
  run: (active: SourceMask) => void,
  active: boolean,
]

export type CompiledScope = readonly [
  add: (reads: SourceMask, run: (active: SourceMask) => void, writes?: SourceMask) => () => void,
  invalidate: (sources: SourceMask) => void,
  batch: <T>(operation: () => T) => T,
  dispose: () => void,
]

type SourceOperations = readonly [
  empty: (mask: SourceMask) => boolean,
  intersects: (left: SourceMask, right: SourceMask) => boolean,
  union: (left: SourceMask, right: SourceMask) => SourceMask,
]

const wideSourceOperations: SourceOperations = [isEmptySources, intersectsSources, unionSources]
const narrowSourceOperations: SourceOperations = [
  (mask) => mask === 0,
  (left, right) => ((left as number) & (right as number)) !== 0,
  (left, right) => ((left as number) | (right as number)) >>> 0,
]

export type CompiledBinding<T> = readonly [
  brand: typeof BINDING,
  evaluate: () => T,
  scope: CompiledScope,
  reads: SourceMask,
  additionalScope: CompiledScope | undefined,
  additionalReads: SourceMask | undefined,
]

export type OwnedBlock = readonly [
  brand: typeof STRUCTURAL,
  mount: (parent: Node, before: Node | null) => void,
]

export type StructuralBinding = OwnedBlock

export type CompiledComponentResult = OwnedBlock

export type CompiledRenderValue =
  | Node
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined
  | CompiledBinding<unknown>
  | StructuralBinding
  | readonly CompiledRenderValue[]

type RenderValue = CompiledRenderValue

export function hasInvalidChild(children: readonly unknown[]): boolean {
  for (const child of children) {
    if (isStructuralBinding(child) || isCompiledBinding(child)) continue
    if (Array.isArray(child)) {
      if (hasInvalidChild(child)) return true
      continue
    }
    const type = typeof child
    if (
      type === 'function' ||
      type === 'symbol' ||
      (type === 'object' && child !== null && !(child instanceof Node))
    ) {
      return true
    }
  }
  return false
}

export function deferred(render: () => CompiledRenderValue): StructuralBinding {
  return [STRUCTURAL, (parent, before) => insertValue(parent, render(), before)]
}

type RefValue<T = Element> =
  | ((value: T | null) => void | (() => void))
  | { current: unknown }
  | null
  | undefined

type PendingRef = [owner: Owner | null, value: RefValue, attached?: (cleanup: () => void) => void]

type NodePosition = readonly [node: Node, parent: Node | null, nextSibling: Node | null]

type PublicationOperation = readonly [
  commit: () => void,
  rollback: () => void,
  abort?: (() => void) | undefined,
  finalize?: (() => void) | undefined,
  priority?: number | undefined,
]

export type CompiledPropTransition = PublicationOperation

type ComponentRange = readonly [start: Comment, end: Comment, scope: CompiledScope]

let activeOwner: Owner | null = null
let activeContextFrame: ContextFrame | null = null
let activeScopeCollector: Set<CompiledScope> | null = null
let activeConstructionOwner: Owner | null = null
let transactionDepth = 0
let drainingFlushes = false
let activePublication: PublicationOperation[] | null = null
const scheduledFlushes = new Set<() => void>()
const scopeOwners = new WeakMap<CompiledScope, Owner>()
const scopeNamespaces = new WeakMap<CompiledScope, IntrinsicNamespace>()
const componentRanges = new WeakMap<CompiledComponentResult, ComponentRange>()
const pendingRefs = new WeakMap<Element, PendingRef>()
const componentCommitOwners = new WeakMap<Comment, Owner>()
const pendingOwnerCommits = new WeakMap<Owner, Set<() => void>>()

export function createCompiledScope(): CompiledScope {
  return createScope(wideSourceOperations)
}

export function createNarrowCompiledScope(): CompiledScope {
  return createScope(narrowSourceOperations)
}

function createScope(operations: SourceOperations): CompiledScope {
  const namespace = currentIntrinsicNamespace()
  const owner = createOwner()
  const updaters: Array<CompiledUpdater | undefined> = []
  const freeUpdaterIndexes: number[] = []
  const addedDuringFlush = new Set<CompiledUpdater>()
  let batchDepth = 0
  let flushing = false
  let pending: SourceMask = 0

  const flush = (): void => {
    if (owner[0] || flushing) return
    flushing = true
    try {
      let pass = 0
      while (!operations[0](pending)) {
        pass += 1
        if (pass > MAX_FLUSH_PASSES) {
          pending = 0
          throw new Error(DEV ? 'Vidact compiled scope did not stabilize' : 'V001')
        }

        let active = pending
        pending = 0
        const updaterCount = updaters.length
        for (let index = 0; index < updaterCount; index += 1) {
          const updater = updaters[index]
          if (
            updater === undefined ||
            addedDuringFlush.has(updater) ||
            !updater[3] ||
            !operations[1](active, updater[0])
          ) {
            continue
          }
          updater[2](active)
          if (updater[1] !== undefined) active = operations[2](active, updater[1])
        }
        addedDuringFlush.clear()
      }
    } finally {
      addedDuringFlush.clear()
      flushing = false
    }
  }

  const scope: CompiledScope = [
    (reads, run, writes) => {
      if (owner[0]) {
        throw new Error(DEV ? 'cannot add an updater to a disposed scope' : 'V002')
      }
      const entry: CompiledUpdater = [
        reads,
        writes,
        (active) => withScopeNamespace(scope, () => run(active)),
        true,
      ]
      const reusableIndex = freeUpdaterIndexes.pop()
      const index = reusableIndex ?? updaters.length
      updaters[index] = entry
      if (flushing) addedDuringFlush.add(entry)
      const remove = (): void => {
        if (updaters[index] !== entry) return
        entry[3] = false
        updaters[index] = undefined
        freeUpdaterIndexes.push(index)
      }
      if (activeOwner !== null && activeOwner !== owner) activeOwner[1].add(remove)
      return remove
    },
    (sources) => {
      if (owner[0] || operations[0](sources)) return
      pending = operations[2](pending, sources)
      if (batchDepth === 0) scheduleFlush(flush)
    },
    <T>(operation: () => T): T => {
      batchDepth += 1
      transactionDepth += 1
      try {
        return operation()
      } finally {
        batchDepth -= 1
        if (batchDepth === 0 && !operations[0](pending)) scheduleFlush(flush)
        transactionDepth -= 1
        if (transactionDepth === 0) drainFlushes()
      }
    },
    () => {
      if (owner[0]) return
      try {
        disposeOwner(owner)
      } finally {
        pending = 0
        for (const updater of updaters) {
          if (updater !== undefined) updater[3] = false
        }
        updaters.length = 0
        freeUpdaterIndexes.length = 0
        addedDuringFlush.clear()
      }
    },
  ]
  scopeOwners.set(scope, owner)
  scopeNamespaces.set(scope, namespace)
  activeScopeCollector?.add(scope)
  if (activeScopeCollector !== null) activeConstructionOwner = owner
  return scope
}

export function createCompiledState<T>(
  scope: CompiledScope,
  sourceMask: SourceMask,
  initialValue: T | (() => T),
): StateSlot<T> {
  const assertWritable = stateWriteGuard(scope)
  const value = typeof initialValue === 'function' ? (initialValue as () => T)() : initialValue
  return createStateSlot(scope[1], sourceMask, value, assertWritable)
}

export function createCompiledReducer<State, Action, Initial>(
  scope: CompiledScope,
  sourceMask: SourceMask,
  reducer: (state: State, action: Action) => State,
  initialArg: Initial,
  initialize?: (initialArg: Initial) => State,
): { readonly get: () => State; readonly set: (action: Action) => void } {
  const state = createStateSlot<State>(
    scope[1],
    sourceMask,
    initialize === undefined ? (initialArg as unknown as State) : initialize(initialArg),
    stateWriteGuard(scope),
  )
  return {
    get: state.get,
    set: (action) => state.set((previous) => reducer(previous, action)),
  }
}

export function createCompiledMemo<T>(
  scope: CompiledScope,
  reads: SourceMask,
  writes: SourceMask,
  evaluate: () => T,
  readDependencies: () => readonly unknown[],
): StateSlot<T> {
  let currentDependencies = readDependencies()
  const slot = createStateSlot(scope[1], writes, evaluate(), stateWriteGuard(scope))
  const removeUpdater = scope[0](reads, () => {
    const nextDependencies = readDependencies()
    if (equalDependencies(nextDependencies, currentDependencies)) return
    slot.replace(evaluate())
    currentDependencies = nextDependencies
  })
  const owner = scopeOwners.get(scope)
  if (owner === undefined) {
    removeUpdater()
    throw new Error(DEV ? 'createCompiledMemo received an unknown scope' : 'V003')
  }
  owner[1].add(removeUpdater)
  return slot
}

export interface CompiledContext<T> {
  (props: {
    readonly children?: CompiledRenderValue | readonly CompiledRenderValue[]
    readonly value: T | CompiledBinding<T>
  }): StructuralBinding
  Provider: CompiledContext<T>
  displayName?: string
  readonly [CONTEXT]: T
}

export function createContext<T>(defaultValue: T): CompiledContext<T> {
  let context: CompiledContext<T>
  const provider = ((props: {
    readonly children?: CompiledRenderValue | readonly CompiledRenderValue[]
    readonly value: T | CompiledBinding<T>
  }): StructuralBinding =>
    provideContext(context, props.value, props.children)) as CompiledContext<T>
  context = provider
  context.Provider = provider
  Object.defineProperty(context, CONTEXT, { value: defaultValue })
  return context
}

export function createCompiledContext<T>(
  scope: CompiledScope,
  sourceMask: SourceMask,
  context: CompiledContext<T>,
): StateSlot<T> {
  const input = contextInput(scope, context)
  return createCompiledProp(scope, sourceMask, input)
}

export function createCompiledExternalStore<T>(
  scope: CompiledScope,
  sourceMask: SourceMask,
  storeSubscribe: (onStoreChange: () => void) => () => void,
  getSnapshot: () => T,
  _getServerSnapshot?: () => T,
): StateSlot<T> {
  const owner = scopeOwners.get(scope)
  if (owner === undefined) {
    throw new Error(DEV ? 'createCompiledExternalStore received an unknown scope' : 'V003')
  }
  const slot = createStateSlot(scope[1], sourceMask, getSnapshot(), stateWriteGuard(scope))
  let active = true
  const checkSnapshot = (): void => {
    if (!active) return
    scope[2](() => slot.replace(getSnapshot()))
  }
  const unsubscribe = storeSubscribe(checkSnapshot)
  if (typeof unsubscribe !== 'function') {
    active = false
    throw new TypeError(
      DEV ? 'external store subscribe must return an unsubscribe function' : 'V020',
    )
  }
  try {
    checkSnapshot()
  } catch (error) {
    active = false
    unsubscribe()
    throw error
  }
  owner[1].add(() => {
    active = false
    unsubscribe()
  })
  return slot
}

export function useContext<T>(context: CompiledContext<T>): T {
  if (activeConstructionOwner === null) {
    throw new Error(DEV ? 'useContext must run during compiled component construction' : 'V019')
  }
  const input = contextInputFromFrame(activeConstructionOwner[2], context)
  return isCompiledBinding(input) ? (input[1]() as T) : (input as T)
}

export function use<T>(context: CompiledContext<T>): T {
  return useContext(context)
}

export function useSyncExternalStore<T>(
  _subscribe: (onStoreChange: () => void) => () => void,
  _getSnapshot: () => T,
  _getServerSnapshot?: () => T,
): T {
  throw new Error(DEV ? 'useSyncExternalStore requires compiler lowering' : 'V021')
}

export function useMemo<T>(factory: () => T, _dependencies: readonly unknown[]): T {
  return factory()
}

export function useCallback<T extends Function>(callback: T, _dependencies: readonly unknown[]): T {
  return callback
}

export function createCompiledProp<T>(
  scope: CompiledScope,
  sourceMask: SourceMask,
  input: T | CompiledBinding<T>,
  fallback?: () => T,
): StateSlot<T> {
  const assertWritable = stateWriteGuard(scope)
  const upstream = isCompiledBinding(input) ? input : undefined
  const read = (): T => {
    const value = upstream === undefined ? (input as T) : upstream[1]()
    return value === undefined && fallback !== undefined ? fallback() : value
  }
  const slot = createStateSlot<T>(scope[1], sourceMask, read(), assertWritable)
  if (upstream !== undefined) {
    const remove = subscribeBinding(upstream, () => slot.replace(read()))
    const owner = scopeOwners.get(scope)
    if (owner === undefined) {
      throw new Error(DEV ? 'createCompiledProp received an unknown scope' : 'V003')
    }
    owner[1].add(remove)
  }
  return slot
}

export function createCompiledRestProp(
  scope: CompiledScope,
  sourceMask: SourceMask,
  input: Record<string, unknown>,
  excludedNames: readonly string[],
): StateSlot<Record<string, unknown>> {
  const excluded = new Set(excludedNames)
  const entries = (): Array<[string, unknown]> =>
    Object.entries(input).filter(([name]) => !excluded.has(name))
  const read = (): Record<string, unknown> =>
    Object.fromEntries(
      entries().map(([name, value]) => [name, isCompiledBinding(value) ? value[1]() : value]),
    )
  const slot = createStateSlot(scope[1], sourceMask, read(), stateWriteGuard(scope))
  const componentSpreadSource = (input as Record<PropertyKey, unknown>)[COMPONENT_SPREAD_SOURCE]
  const upstreams = new Set(
    entries()
      .map(([, value]) => value)
      .filter(isCompiledBinding),
  )
  if (isCompiledBinding(componentSpreadSource)) upstreams.add(componentSpreadSource)
  const removers = [...upstreams].map((upstream) =>
    subscribeBinding(upstream, () => slot.replace(read())),
  )
  const owner = scopeOwners.get(scope)
  if (owner === undefined) {
    throw new Error(DEV ? 'createCompiledRestProp received an unknown scope' : 'V003')
  }
  owner[1].add(() => {
    for (const remove of removers) remove()
  })
  return slot
}

function stateWriteGuard(scope: CompiledScope): () => void {
  const owner = scopeOwners.get(scope)
  if (owner === undefined) {
    throw new Error(DEV ? 'compiled state received an unknown scope' : 'V003')
  }
  return () => {
    if (owner[0]) throw new Error(DEV ? 'cannot update state after disposal' : 'V012')
  }
}

export function binding<T>(
  scope: CompiledScope,
  reads: SourceMask,
  evaluate: () => T,
  additionalScope?: CompiledScope,
  additionalReads?: SourceMask,
): CompiledBinding<T> {
  return [BINDING, evaluate, scope, reads, additionalScope, additionalReads]
}

export function compiledEvent<T extends Event>(
  scope: CompiledScope,
  handler: (event: T) => void,
): (event: T) => void {
  return (event) => scope[2](() => handler(event))
}

export function when(
  scope: CompiledScope,
  reads: SourceMask,
  condition: () => unknown,
  render: () => RenderValue,
  additionalScope?: CompiledScope,
  additionalReads?: SourceMask,
): StructuralBinding {
  return structural(scope, (parent, before) => {
    const start = document.createComment(DEV ? 'vidact:when' : '')
    const end = document.createComment(DEV ? '/vidact:when' : '')
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
      const [fragment, staged] = stageRender(render, nextOwner)
      currentParent.insertBefore(fragment, end)
      for (const node of staged) commitPendingRefs(node)
      branchOwner = nextOwner
      mounted = true
    }

    const removeUpdater = subscribe(scope, reads, update, additionalScope, additionalReads)
    try {
      update()
    } catch (error) {
      removeUpdater()
      throw error
    }
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

export type ChoiceMode = 'truthy' | 'not-nullish'

export function choose(
  scope: CompiledScope,
  reads: SourceMask,
  mode: ChoiceMode,
  select: () => unknown,
  consequent: () => CompiledRenderValue,
  alternate: () => CompiledRenderValue,
  additionalScope?: CompiledScope,
  additionalReads?: SourceMask,
): StructuralBinding {
  return structural(scope, (parent, before) => {
    const start = document.createComment(DEV ? 'vidact:choice' : '')
    const end = document.createComment(DEV ? '/vidact:choice' : '')
    parent.insertBefore(start, before)
    parent.insertBefore(end, before)
    let selected = -1
    let branchOwner: Owner | null = null
    let branchNodes: readonly Node[] = []

    const update = (): void => {
      const value = select()
      const next =
        mode === 'not-nullish' ? (value === null || value === undefined ? 1 : 0) : value ? 0 : 1
      if (next === selected) return
      const currentParent = rangeParent(start, end, 'choice block')
      const nextOwner = createOwner()
      const [fragment, nodes] = stageRender(next === 0 ? consequent : alternate, nextOwner)
      currentParent.insertBefore(fragment, end)
      try {
        for (const node of nodes) commitPendingRefs(node)
      } catch (error) {
        disposePublished(nextOwner, nodes)
        throw error
      }

      const previousOwner = branchOwner
      const previousNodes = branchNodes
      branchOwner = nextOwner
      branchNodes = nodes
      selected = next
      disposePublished(previousOwner, previousNodes)
    }

    const removeUpdater = subscribe(scope, reads, update, additionalScope, additionalReads)
    try {
      update()
    } catch (error) {
      removeUpdater()
      throw error
    }
    onCleanup(() => {
      removeUpdater()
      try {
        disposePublished(branchOwner, branchNodes)
      } finally {
        start.remove()
        end.remove()
      }
    })
  })
}

export function dispatch(
  scope: CompiledScope,
  reads: SourceMask,
  type: () => unknown,
  key: () => unknown,
  render: () => CompiledRenderValue,
  additionalScope?: CompiledScope,
  additionalReads?: SourceMask,
): StructuralBinding {
  return structural(scope, (parent, before) => {
    const start = document.createComment(DEV ? 'vidact:dispatch' : '')
    const end = document.createComment(DEV ? '/vidact:dispatch' : '')
    parent.insertBefore(start, before)
    parent.insertBefore(end, before)
    const unset = Symbol('Vidact.UnsetIdentity')
    let currentType: unknown = unset
    let currentKey: unknown = unset
    let currentOwner: Owner | null = null
    let currentNodes: readonly Node[] = []

    const update = (): void => {
      const nextType = type()
      const nextKey = key()
      if (
        currentType !== unset &&
        Object.is(nextType, currentType) &&
        Object.is(nextKey, currentKey)
      ) {
        return
      }
      const currentParent = rangeParent(start, end, 'dispatch block')
      const nextOwner = createOwner()
      const [fragment, nodes] = stageRender(render, nextOwner)
      currentParent.insertBefore(fragment, end)
      try {
        for (const node of nodes) commitPendingRefs(node)
      } catch (error) {
        disposePublished(nextOwner, nodes)
        throw error
      }

      const previousOwner = currentOwner
      const previousNodes = currentNodes
      currentType = nextType
      currentKey = nextKey
      currentOwner = nextOwner
      currentNodes = nodes
      disposePublished(previousOwner, previousNodes)
    }

    const removeUpdater = subscribe(scope, reads, update, additionalScope, additionalReads)
    try {
      update()
    } catch (error) {
      removeUpdater()
      throw error
    }
    onCleanup(() => {
      removeUpdater()
      try {
        disposePublished(currentOwner, currentNodes)
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
  render: (value: StateSlot<T>, index: StateSlot<number>, itemScope: CompiledScope) => RenderValue,
  additionalScope?: CompiledScope,
  additionalReads?: SourceMask,
): StructuralBinding {
  return structural(scope, (parent, before) => {
    const itemSource = 1
    const indexSource = 2
    const list = createKeyedList(
      parent,
      {
        key,
        render(value, index) {
          const owner = createOwner()
          const itemScope = createNarrowCompiledScope()
          const valueSlot = createCompiledState(itemScope, itemSource, value)
          const indexSlot = createCompiledState(itemScope, indexSource, index)
          try {
            const nodes = withOwner(owner, () => {
              onCleanup(itemScope[3])
              return materialize(render(valueSlot, indexSlot, itemScope))
            })
            return [
              nodes,
              (nextValue: T, nextIndex: number) => {
                itemScope[2](() => {
                  valueSlot.set(nextValue)
                  indexSlot.set(nextIndex)
                })
              },
              () => disposeOwner(owner),
            ] as const
          } catch (error) {
            disposeOwner(owner)
            throw error
          }
        },
      },
      before,
    )
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
    const removeUpdater = subscribe(scope, reads, update, additionalScope, additionalReads)
    onCleanup(() => {
      removeUpdater()
      list.dispose()
    })
  })
}

export function indexed<T>(
  scope: CompiledScope,
  reads: SourceMask,
  values: () => readonly T[],
  render: (value: StateSlot<T>, index: StateSlot<number>, itemScope: CompiledScope) => RenderValue,
  additionalScope?: CompiledScope,
  additionalReads?: SourceMask,
): StructuralBinding {
  return structural(scope, (parent, before) => {
    const itemSource = 1
    const indexSource = 2
    const list = createIndexedList<T>(
      parent,
      {
        render(value, index) {
          const owner = createOwner()
          const itemScope = createNarrowCompiledScope()
          const valueSlot = createCompiledState(itemScope, itemSource, value)
          const indexSlot = createCompiledState(itemScope, indexSource, index)
          try {
            const nodes = withOwner(owner, () => {
              onCleanup(itemScope[3])
              return materialize(render(valueSlot, indexSlot, itemScope))
            })
            return [
              nodes,
              (nextValue: T, nextIndex: number) => {
                itemScope[2](() => {
                  valueSlot.set(nextValue)
                  indexSlot.set(nextIndex)
                })
              },
              () => disposeOwner(owner),
            ] as const
          } catch (error) {
            disposeOwner(owner)
            throw error
          }
        },
      },
      before,
    )
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
    const removeUpdater = subscribe(scope, reads, update, additionalScope, additionalReads)
    onCleanup(() => {
      removeUpdater()
      list.dispose()
    })
  })
}

export function compiledRoot(
  scope: CompiledScope,
  render: () => CompiledRenderValue,
): CompiledComponentResult {
  const owner = scopeOwners.get(scope)
  if (owner === undefined) {
    throw new Error(DEV ? 'compiledRoot received an unknown scope' : 'V004')
  }
  const start = document.createComment(DEV ? 'vidact:component' : '')
  const end = document.createComment(DEV ? '/vidact:component' : '')
  componentCommitOwners.set(end, owner)
  const fragment = document.createDocumentFragment()
  fragment.append(start, end)
  owner[1].add(() => {
    try {
      removeBetween(start, end)
    } finally {
      start.remove()
      end.remove()
    }
  })

  try {
    withOwner(owner, () => withScopeNamespace(scope, () => insertValue(fragment, render(), end)))
  } catch (error) {
    try {
      scope[3]()
    } catch {
      // Preserve the render error that made this component unmountable.
    }
    throw error
  }

  let mounted = false
  const component: CompiledComponentResult = [
    STRUCTURAL,
    (parent, before) => {
      if (mounted) throw new Error(DEV ? 'compiled component is already mounted' : 'V005')
      mounted = true
      adoptCompiledRoot(component)
      try {
        parent.insertBefore(fragment, before)
      } catch (error) {
        try {
          scope[3]()
        } catch {
          // Preserve the insertion error that made this component unmountable.
        }
        throw error
      }
    },
  ]
  componentRanges.set(component, [start, end, scope])
  return component
}

export function adoptCompiledRoot(root: unknown): void {
  if (!isCompiledComponentResult(root)) return
  const range = componentRanges.get(root)
  if (range === undefined) return
  const owner = scopeOwners.get(range[2])
  if (activeOwner !== null && owner !== undefined && activeOwner !== owner) {
    activeOwner[1].add(range[2][3])
  }
}

export function constructCompiledComponent<T extends CompiledRenderValue>(component: () => T): T {
  const previousCollector = activeScopeCollector
  const previousConstructionOwner = activeConstructionOwner
  const scopes = new Set<CompiledScope>()
  activeScopeCollector = scopes
  activeConstructionOwner = null
  try {
    return component()
  } catch (error) {
    // oxlint-disable-next-line unicorn/no-array-reverse - scopes is already copied to avoid mutation during iteration
    for (const scope of [...scopes].reverse()) {
      try {
        scope[3]()
      } catch {
        // Preserve the construction error that made this component unmountable.
      }
    }
    throw error
  } finally {
    activeScopeCollector = previousCollector
    activeConstructionOwner = previousConstructionOwner
  }
}

export function queueElementRef(element: Element, value: unknown): void {
  if (!isRefValue(value)) {
    throw new TypeError(DEV ? 'ref must be a callback or an object with current' : 'V006')
  }
  pendingRefs.set(element, [activeOwner, value])
}

export function useImperativeHandle<T>(
  ref: RefValue<T>,
  create: () => T,
  dependencies?: readonly unknown[],
): void {
  const owner = activeConstructionOwner
  if (owner === null) {
    throw new Error(
      DEV ? 'useImperativeHandle must run during compiled component construction' : 'V013',
    )
  }
  if (!isRefValue(ref)) {
    throw new TypeError(
      DEV ? 'imperative ref must be null, a callback, or an object with current' : 'V006',
    )
  }
  if (dependencies !== undefined && dependencies.length !== 0) {
    throw new Error(
      DEV ? 'reactive useImperativeHandle dependencies are not supported yet' : 'V014',
    )
  }
  queueOwnerCommit(owner, () => owner[1].add(attachRef(ref, create())))
}

type EffectResult = void | (() => void)

export function useLayoutEffect(
  create: () => EffectResult,
  dependencies?: readonly unknown[],
): void {
  registerEffect(create, dependencies, false)
}

export function useEffect(create: () => EffectResult, dependencies?: readonly unknown[]): void {
  registerEffect(create, dependencies, true)
}

function registerEffect(
  create: () => EffectResult,
  dependencies: readonly unknown[] | undefined,
  passive: boolean,
): void {
  const owner = activeConstructionOwner
  if (owner === null) {
    throw new Error(DEV ? 'effects must run during compiled component construction' : 'V016')
  }
  if (dependencies !== undefined && dependencies.length !== 0) {
    throw new Error(DEV ? 'reactive effect dependencies require compiler lowering' : 'V017')
  }
  let cleanup = (): void => {}
  let generation = 0
  const run = (): void => {
    cleanup()
    cleanup = readEffectCleanup(create())
  }
  queueOwnerCommit(owner, () => {
    if (passive) {
      const scheduled = ++generation
      queueMicrotask(() => {
        if (!owner[0] && scheduled === generation) run()
      })
    } else {
      run()
    }
  })
  owner[1].add(() => {
    generation += 1
    if (passive) queueMicrotask(cleanup)
    else cleanup()
  })
}

export function compiledLayoutEffect(
  scope: CompiledScope,
  reads: SourceMask,
  readCreate: () => () => EffectResult,
  readDependencies?: () => readonly unknown[],
): void {
  compiledEffect(scope, reads, readCreate, readDependencies, false)
}

export function compiledEffect(
  scope: CompiledScope,
  reads: SourceMask,
  readCreate: () => () => EffectResult,
  readDependencies?: () => readonly unknown[],
  passive = true,
): void {
  const owner = activeConstructionOwner
  if (owner === null || scopeOwners.get(scope) !== owner) {
    throw new Error(DEV ? 'compiled effects must run in their component scope' : 'V016')
  }
  let mounted = false
  let generation = 0
  let currentDependencies: readonly unknown[] | undefined
  let cleanup = (): void => {}
  const run = (): void => {
    const nextDependencies = readDependencies?.()
    if (
      mounted &&
      readDependencies !== undefined &&
      equalDependencies(nextDependencies, currentDependencies)
    ) {
      return
    }
    cleanup()
    cleanup = readEffectCleanup(readCreate()())
    currentDependencies = nextDependencies
    mounted = true
  }
  const schedule = (): void => {
    if (!passive) {
      run()
      return
    }
    const scheduled = ++generation
    queueMicrotask(() => {
      if (!owner[0] && scheduled === generation) run()
    })
  }
  queueOwnerCommit(owner, schedule)
  const removeUpdater = subscribe(scope, reads, () => {
    if (passive) schedule()
    else stagePublication([() => {}, () => {}, undefined, run, 20])
  })
  owner[1].add(() => {
    generation += 1
    removeUpdater()
    if (passive) queueMicrotask(cleanup)
    else cleanup()
  })
}

function readEffectCleanup(result: EffectResult): () => void {
  if (result === undefined) return () => {}
  if (typeof result === 'function') return result
  throw new TypeError(DEV ? 'an effect must return a cleanup function or undefined' : 'V018')
}

export function compiledImperativeHandle<T>(
  scope: CompiledScope,
  reads: SourceMask,
  readRef: () => RefValue<T>,
  create: () => T,
  readDependencies?: () => readonly unknown[],
): void {
  const owner = activeConstructionOwner
  if (owner === null || scopeOwners.get(scope) !== owner) {
    throw new Error(
      DEV ? 'compiledImperativeHandle must run in its compiled component scope' : 'V013',
    )
  }

  let mounted = false
  let currentRef: RefValue<T>
  let currentHandle: T
  let currentDependencies: readonly unknown[] | undefined
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- This placeholder is replaced by the committed resource cleanup.
  let cleanup = (): void => {}

  const commitInitial = (): void => {
    currentRef = readImperativeRef(readRef())
    currentDependencies = readDependencies?.()
    currentHandle = create()
    cleanup = attachRef(currentRef, currentHandle)
    mounted = true
  }
  queueOwnerCommit(owner, commitInitial)

  const update = (): void => {
    if (!mounted) return
    const nextRef = readImperativeRef(readRef())
    const nextDependencies = readDependencies?.()
    if (
      Object.is(nextRef, currentRef) &&
      readDependencies !== undefined &&
      equalDependencies(nextDependencies, currentDependencies)
    ) {
      return
    }

    const previousRef = currentRef
    const previousHandle = currentHandle
    const previousDependencies = currentDependencies
    const previousCleanup = cleanup
    let nextCleanup: (() => void) | undefined
    let finalized = false
    stagePublication([
      () => {},
      () => {
        if (!finalized) return
        nextCleanup?.()
        cleanup = attachRef(previousRef, previousHandle)
        currentRef = previousRef
        currentHandle = previousHandle
        currentDependencies = previousDependencies
        finalized = false
      },
      undefined,
      () => {
        const nextHandle = create()
        if (Object.is(nextRef, previousRef)) {
          try {
            previousCleanup()
          } catch (error) {
            try {
              cleanup = attachRef(previousRef, previousHandle)
            } catch {
              // Preserve the cleanup error that aborted publication.
            }
            throw error
          }
          try {
            nextCleanup = attachRef(nextRef, nextHandle)
          } catch (error) {
            try {
              cleanup = attachRef(previousRef, previousHandle)
            } catch {
              // Preserve the next-ref attachment error.
            }
            throw error
          }
        } else {
          nextCleanup = attachRef(nextRef, nextHandle)
          try {
            previousCleanup()
          } catch (error) {
            nextCleanup()
            try {
              cleanup = attachRef(previousRef, previousHandle)
            } catch {
              // Preserve the previous-ref cleanup error.
            }
            throw error
          }
        }
        cleanup = nextCleanup
        currentRef = nextRef
        currentHandle = nextHandle
        currentDependencies = nextDependencies
        finalized = true
      },
      10,
    ])
  }
  const removeUpdater = subscribe(scope, reads, update)
  owner[1].add(() => {
    removeUpdater()
    cleanup()
  })
}

function queueOwnerCommit(owner: Owner, commit: () => void): void {
  let commits = pendingOwnerCommits.get(owner)
  if (commits === undefined) {
    commits = new Set()
    pendingOwnerCommits.set(owner, commits)
  }
  commits.add(commit)
}

function readImperativeRef<T>(ref: RefValue<T>): RefValue<T> {
  if (!isRefValue(ref)) {
    throw new TypeError(
      DEV ? 'imperative ref must be null, a callback, or an object with current' : 'V006',
    )
  }
  return ref
}

function equalDependencies(
  next: readonly unknown[] | undefined,
  previous: readonly unknown[] | undefined,
): boolean {
  if (next === undefined || previous === undefined || next.length !== previous.length) return false
  return next.every((value, index) => Object.is(value, previous[index]))
}

export function mountCompiledRef(element: Element, value: CompiledBinding<unknown>): void {
  const initial = value[1]()
  if (!isRefValue(initial)) {
    throw new TypeError(DEV ? 'ref must be null, a callback, or an object with current' : 'V006')
  }
  let current: RefValue = initial
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- This placeholder is replaced when the ref attaches.
  let cleanup = (): void => {}
  const pending: PendingRef = [activeOwner, current, (attached) => (cleanup = attached)]
  pendingRefs.set(element, pending)

  const removeUpdater = subscribeBinding(value, () => {
    const next = value[1]()
    if (Object.is(next, current)) return
    if (!isRefValue(next)) {
      throw new TypeError(DEV ? 'ref must be null, a callback, or an object with current' : 'V006')
    }
    const previous = current
    let nextCleanup: (() => void) | undefined
    let committed = false
    stagePublication([
      () => {
        nextCleanup = attachRef(next, element)
        cleanup()
        cleanup = nextCleanup
        current = next
        committed = true
      },
      () => {
        if (!committed) {
          nextCleanup?.()
          return
        }
        cleanup()
        cleanup = attachRef(previous, element)
        current = previous
        committed = false
      },
    ])
  })
  onCleanup(() => {
    removeUpdater()
    if (pendingRefs.get(element) === pending) pendingRefs.delete(element)
    cleanup()
  })
}

export function registerCompiledCleanup(cleanup: () => void): void {
  onCleanup(cleanup)
}

export function mountCompiled(
  component: () => CompiledComponentResult,
  host: ParentNode,
): { dispose: () => void } {
  const root = constructCompiledComponent(component)
  const range = componentRanges.get(root)
  if (range === undefined) {
    throw new Error(DEV ? 'mountCompiled received an unknown component result' : 'V007')
  }
  const previous = [...host.childNodes]
  try {
    root[1](host, previous[0] ?? null)
    commitRangeRefs(range[0], range[1])
    commitOwnerResources(scopeOwners.get(range[2]))
    for (const node of previous) host.removeChild(node)
  } catch (error) {
    try {
      range[2][3]()
    } catch {
      // Preserve the mount error while still running every component cleanup.
    }
    throw error
  }
  return {
    dispose: range[2][3],
  }
}

export function isCompiledBinding(value: unknown): value is CompiledBinding<unknown> {
  return Array.isArray(value) && value[0] === BINDING
}

export function isStructuralBinding(value: unknown): value is StructuralBinding {
  return Array.isArray(value) && value[0] === STRUCTURAL
}

export function isCompiledComponentResult(value: unknown): value is CompiledComponentResult {
  return isStructuralBinding(value) && componentRanges.has(value)
}

export function mountCompiledBinding(parent: Node, value: CompiledBinding<unknown>): void {
  mountCompiledBindingBefore(parent, value, null)
}

export function mountCompiledProp(
  value: CompiledBinding<unknown>,
  apply: (next: unknown) => void | (() => void),
): void {
  let current = value[1]()
  let cleanup = apply(current)
  const removeUpdater = subscribeBinding(value, () => {
    const next = value[1]()
    if (Object.is(next, current)) return
    const previous = current
    let nextCleanup: void | (() => void)
    let committedNext = false
    stagePublication([
      () => {
        try {
          nextCleanup = apply(next)
        } catch (error) {
          try {
            apply(previous)
          } catch {
            // Preserve the setter error that aborted publication.
          }
          throw error
        }
        committedNext = true
        cleanup?.()
        cleanup = nextCleanup
        current = next
      },
      () => {
        if (!committedNext) return
        nextCleanup?.()
        cleanup = apply(previous)
        current = previous
        committedNext = false
      },
    ])
  })
  onCleanup(() => {
    removeUpdater()
    cleanup?.()
  })
}

export function mountCompiledPropTransition<T>(
  value: CompiledBinding<T>,
  initialize: (initial: T) => void,
  prepare: (next: T, previous: T) => CompiledPropTransition | undefined,
): void {
  let current = value[1]()
  initialize(current)
  const removeUpdater = subscribeBinding(value, () => {
    const next = value[1]()
    if (Object.is(next, current)) return
    const previous = current
    const transition = prepare(next, previous)
    let attempted = false
    stagePublication([
      () => {
        attempted = true
        transition?.[0]()
        current = next
      },
      () => {
        if (!attempted) return
        try {
          transition?.[1]()
        } finally {
          current = previous
          attempted = false
        }
      },
      transition?.[2],
      transition?.[3],
      transition?.[4],
    ])
  })
  onCleanup(removeUpdater)
}

function structural(scope: CompiledScope, mount: StructuralBinding[1]): StructuralBinding {
  let mounted = false
  const context = activeContextFrame ?? activeOwner?.[2] ?? scopeOwners.get(scope)?.[2] ?? null
  return [
    STRUCTURAL,
    (parent, before) => {
      if (mounted) throw new Error(DEV ? 'compiled block is already mounted' : 'V008')
      mounted = true
      withContextFrame(context, () => withScopeNamespace(scope, () => mount(parent, before)))
    },
  ]
}

function subscribe(
  scope: CompiledScope,
  reads: SourceMask,
  run: () => void,
  additionalScope?: CompiledScope,
  additionalReads?: SourceMask,
): () => void {
  const context = activeContextFrame ?? activeOwner?.[2] ?? scopeOwners.get(scope)?.[2] ?? null
  const removers = [scope[0](reads, () => withContextFrame(context, run))]
  if (additionalScope !== undefined && additionalReads !== undefined) {
    removers.push(
      additionalScope[0](additionalReads, () =>
        withContextFrame(context, () => withScopeNamespace(scope, run)),
      ),
    )
  }
  return () => {
    for (const remove of removers) remove()
  }
}

function subscribeBinding(compiledBinding: CompiledBinding<unknown>, run: () => void): () => void {
  return subscribe(
    compiledBinding[2],
    compiledBinding[3],
    run,
    compiledBinding[4],
    compiledBinding[5],
  )
}

function withScopeNamespace<Result>(scope: CompiledScope, operation: () => Result): Result {
  return withIntrinsicNamespace(scopeNamespaces.get(scope), operation)
}

function createOwner(): Owner {
  return [false, new Set(), activeContextFrame ?? activeOwner?.[2] ?? null]
}

function provideContext<T>(
  context: CompiledContext<T>,
  input: T | CompiledBinding<T>,
  children: CompiledRenderValue | readonly CompiledRenderValue[] | undefined,
): StructuralBinding {
  const parentContext = activeContextFrame ?? activeOwner?.[2] ?? null
  let mounted = false
  return [
    STRUCTURAL,
    (parent, before) => {
      if (mounted) throw new Error(DEV ? 'context provider is already mounted' : 'V008')
      mounted = true
      withContextFrame(
        { context: context as CompiledContext<unknown>, input, parent: parentContext },
        () => insertValue(parent, children, before),
      )
    },
  ]
}

function contextInput<T>(
  scope: CompiledScope,
  context: CompiledContext<T>,
): T | CompiledBinding<T> {
  const owner = scopeOwners.get(scope)
  if (owner === undefined) {
    throw new Error(DEV ? 'createCompiledContext received an unknown scope' : 'V003')
  }
  return contextInputFromFrame(owner[2], context)
}

function contextInputFromFrame<T>(
  frame: ContextFrame | null,
  context: CompiledContext<T>,
): T | CompiledBinding<T> {
  if (typeof context !== 'function' || !(CONTEXT in context)) {
    throw new TypeError(DEV ? 'useContext requires a context created by createContext' : 'V018')
  }
  for (let current = frame; current !== null; current = current.parent) {
    if (current.context === context) return current.input as T | CompiledBinding<T>
  }
  return context[CONTEXT]
}

function withOwner<T>(owner: Owner, operation: () => T): T {
  const previous = activeOwner
  const previousContext = activeContextFrame
  activeOwner = owner
  activeContextFrame = owner[2]
  try {
    return operation()
  } finally {
    activeOwner = previous
    activeContextFrame = previousContext
  }
}

function withContextFrame<T>(frame: ContextFrame | null, operation: () => T): T {
  const previous = activeContextFrame
  activeContextFrame = frame
  try {
    return operation()
  } finally {
    activeContextFrame = previous
  }
}

function onCleanup(cleanup: () => void): void {
  activeOwner?.[1].add(cleanup)
}

function disposeOwner(owner: Owner): void {
  if (owner[0]) return
  owner[0] = true
  pendingOwnerCommits.delete(owner)
  const cleanups = [...owner[1]]
  owner[1].clear()
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
  const start = document.createComment(DEV ? 'vidact:binding' : '')
  const end = document.createComment(DEV ? '/vidact:binding' : '')
  parent.insertBefore(start, before)
  parent.insertBefore(end, before)
  const unset = Symbol(DEV ? 'Vidact.UnsetBinding' : undefined)
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
    const next = value[1]()
    if (current !== unset && Object.is(next, current)) return
    const currentParent = rangeParent(start, end, 'binding range')

    if (isScalarRenderValue(next)) {
      const content = toText(next)
      if (text !== null) {
        const target = text
        const previousContent = target.data
        const previous = current
        stagePublication([
          () => {
            if (target.data !== content) target.data = content
            current = next
          },
          () => {
            if (target.data !== previousContent) target.data = previousContent
            current = previous
          },
        ])
        return
      }
      clear()
      text = document.createTextNode(content)
      currentParent.insertBefore(text, end)
      current = next
      return
    }

    const nextOwner = createOwner()
    const [fragment, staged] = stageValue(next as RenderValue, nextOwner)
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
  const removeUpdater = subscribeBinding(value, update)
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
): readonly [fragment: DocumentFragment, nodes: readonly Node[]] {
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
  return [fragment, [...fragment.childNodes]]
}

function stageRender(
  render: () => CompiledRenderValue,
  owner: Owner,
): readonly [fragment: DocumentFragment, nodes: readonly Node[]] {
  try {
    return stageValue(withOwner(owner, render), owner)
  } catch (error) {
    try {
      disposeOwner(owner)
    } catch {
      // Preserve the render or staging error after every registered cleanup ran.
    }
    throw error
  }
}

function insertValue(
  parent: Node,
  value: RenderValue,
  before: Node | null,
  moves?: NodePosition[],
): void {
  if (value === null || value === undefined || typeof value === 'boolean') return
  if (isStructuralBinding(value)) {
    adoptCompiledRoot(value)
    value[1](parent, before)
    return
  }
  if (isCompiledBinding(value)) {
    mountCompiledBindingBefore(parent, value, before)
    return
  }
  if (Array.isArray(value)) {
    if (hasInvalidChild(value)) {
      throw new TypeError(
        DEV ? 'unsupported compiled child value; expected a DOM node or owned block' : 'V009',
      )
    }
    for (const item of value) insertValue(parent, item, before, moves)
    return
  }
  if (value instanceof DocumentFragment) {
    // oxlint-disable-next-line unicorn/no-useless-spread -- Snapshot the live NodeList before moving nodes.
    for (const child of [...value.childNodes]) insertValue(parent, child, before, moves)
    return
  }
  if (value instanceof Node) {
    moves?.push([value, value.parentNode, value.nextSibling])
    adoptCompiledRoot(value)
    claimPendingRefOwners(value)
    parent.insertBefore(value, before)
    if (!(parent instanceof DocumentFragment)) commitPendingRefs(value)
    return
  }
  if (typeof value === 'object' || typeof value === 'function' || typeof value === 'symbol') {
    throw new TypeError(
      DEV ? 'unsupported compiled child value; expected a DOM node or owned block' : 'V009',
    )
  }
  parent.insertBefore(document.createTextNode(String(value)), before)
}

function restoreNodePositions(positions: readonly NodePosition[]): void {
  for (let index = positions.length - 1; index >= 0; index -= 1) {
    const position = positions[index]
    if (position === undefined) continue
    if (position[1] === null) {
      position[0].parentNode?.removeChild(position[0])
      continue
    }
    const before = position[2]?.parentNode === position[1] ? position[2] : null
    position[1].insertBefore(position[0], before)
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
    throw new Error(DEV ? `cannot update a detached ${description}` : 'V010')
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

function disposePublished(owner: Owner | null, nodes: readonly Node[]): void {
  try {
    if (owner !== null) disposeOwner(owner)
  } finally {
    for (const node of nodes) node.parentNode?.removeChild(node)
  }
}

function toText(value: unknown): string {
  return value === null || value === undefined || typeof value === 'boolean' ? '' : String(value)
}

function isScalarRenderValue(
  value: unknown,
): value is string | number | bigint | boolean | null | undefined {
  return (
    value === null ||
    value === undefined ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean'
  )
}

function isRefValue(value: unknown): value is RefValue {
  return (
    value === null ||
    value === undefined ||
    typeof value === 'function' ||
    (typeof value === 'object' && value !== null && 'current' in value)
  )
}

function claimPendingRefOwners(root: Node): void {
  visitNodes(root, (node) => {
    if (!(node instanceof Element)) return
    const pending = pendingRefs.get(node)
    if (pending !== undefined && pending[0] === null) pending[0] = activeOwner
  })
}

function commitPendingRefs(root: Node): void {
  visitNodes(root, (node) => {
    if (node instanceof Element) {
      const pending = pendingRefs.get(node)
      if (pending !== undefined) {
        pendingRefs.delete(node)
        const owner = pending[0] ?? activeOwner
        const cleanup = attachRef(pending[1], node)
        if (pending[2] === undefined) owner?.[1].add(cleanup)
        else pending[2](cleanup)
      }
    }
    if (node instanceof Comment) commitOwnerResources(componentCommitOwners.get(node))
  })
}

function commitOwnerResources(owner: Owner | undefined): void {
  if (owner === undefined || owner[0]) return
  const commits = pendingOwnerCommits.get(owner)
  if (commits === undefined) return
  pendingOwnerCommits.delete(owner)
  for (const commit of commits) commit()
}

function commitRangeRefs(start: Node, end: Node): void {
  const nodes: Node[] = []
  let node = start.nextSibling
  while (node !== null && node !== end) {
    nodes.push(node)
    node = node.nextSibling
  }
  for (const rangeNode of nodes) commitPendingRefs(rangeNode)
}

function visitNodes(root: Node, visit: (node: Node) => void): void {
  visit(root)
  for (const child of root.childNodes) visitNodes(child, visit)
}

function attachRef<T>(value: RefValue<T>, target: T): () => void {
  if (value === null || value === undefined) return () => {}
  if (typeof value === 'function') {
    const cleanup = value(target)
    return typeof cleanup === 'function' ? cleanup : () => value(null)
  }
  value.current = target
  return () => {
    if (value.current === target) value.current = null
  }
}

function scheduleFlush(flush: () => void): void {
  scheduledFlushes.add(flush)
  if (transactionDepth === 0) drainFlushes()
}

function drainFlushes(): void {
  if (drainingFlushes || transactionDepth > 0) return
  drainingFlushes = true
  const publication: PublicationOperation[] = []
  activePublication = publication
  const runs = new Map<() => void, number>()
  let committing = false
  try {
    while (scheduledFlushes.size > 0) {
      const flush = scheduledFlushes.values().next().value
      if (flush === undefined) break
      scheduledFlushes.delete(flush)
      const runCount = (runs.get(flush) ?? 0) + 1
      if (runCount > MAX_FLUSH_PASSES) {
        scheduledFlushes.clear()
        throw new Error(DEV ? 'Vidact compiled scopes did not stabilize' : 'V011')
      }
      runs.set(flush, runCount)
      flush()
    }
    activePublication = null
    committing = true
    commitPublication(publication)
  } catch (error) {
    activePublication = null
    if (!committing) abortPublication(publication)
    throw error
  } finally {
    activePublication = null
    drainingFlushes = false
  }
}

function stagePublication(operation: PublicationOperation): void {
  if (activePublication === null) {
    operation[0]()
    try {
      operation[3]?.()
    } catch (error) {
      operation[1]()
      throw error
    }
    return
  }
  activePublication.push(operation)
}

function commitPublication(operations: readonly PublicationOperation[]): void {
  const ordered = operations.some((operation) => operation[4] !== undefined)
    ? operations.toSorted((left, right) => (left[4] ?? 0) - (right[4] ?? 0))
    : operations
  const applied: PublicationOperation[] = []
  try {
    for (const operation of ordered) {
      applied.push(operation)
      operation[0]()
    }
  } catch (error) {
    for (let index = applied.length - 1; index >= 0; index -= 1) {
      try {
        applied[index]?.[1]()
      } catch {
        // Preserve the publication error while attempting every inverse.
      }
    }
    for (const operation of ordered.slice(applied.length)) {
      try {
        operation[2]?.()
      } catch {
        // Preserve the publication error while disposing every staged value.
      }
    }
    throw error
  }
  try {
    for (const operation of ordered) operation[3]?.()
  } catch (error) {
    for (let index = applied.length - 1; index >= 0; index -= 1) {
      try {
        applied[index]?.[1]()
      } catch {
        // Preserve the finalization error while attempting every inverse.
      }
    }
    throw error
  }
}

function abortPublication(operations: readonly PublicationOperation[]): void {
  for (let index = operations.length - 1; index >= 0; index -= 1) {
    try {
      operations[index]?.[2]?.()
    } catch {
      // Preserve the computation error while disposing every staged value.
    }
  }
}
