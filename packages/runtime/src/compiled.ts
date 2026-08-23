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

type Owner = [disposed: boolean, cleanups: Set<() => void>]

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

type RefValue = ((value: Element | null) => void | (() => void)) | { current: unknown }

type PendingRef = [owner: Owner | null, value: RefValue]

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
let activeScopeCollector: Set<CompiledScope> | null = null
let transactionDepth = 0
let drainingFlushes = false
let activePublication: PublicationOperation[] | null = null
const scheduledFlushes = new Set<() => void>()
const scopeOwners = new WeakMap<CompiledScope, Owner>()
const scopeNamespaces = new WeakMap<CompiledScope, IntrinsicNamespace>()
const componentRanges = new WeakMap<CompiledComponentResult, ComponentRange>()
const pendingRefs = new WeakMap<Element, PendingRef>()

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
  return scope
}

export function createCompiledState<T>(
  scope: CompiledScope,
  sourceMask: SourceMask,
  initialValue: T | (() => T),
): StateSlot<T> {
  const value = typeof initialValue === 'function' ? (initialValue as () => T)() : initialValue
  return createStateSlot(scope[1], sourceMask, value)
}

export function createCompiledProp<T>(
  scope: CompiledScope,
  sourceMask: SourceMask,
  input: T | CompiledBinding<T>,
  fallback?: () => T,
): StateSlot<T> {
  const upstream = isCompiledBinding(input) ? input : undefined
  const read = (): T => {
    const value = upstream === undefined ? (input as T) : upstream[1]()
    return value === undefined && fallback !== undefined ? fallback() : value
  }
  const slot = createStateSlot<T>(scope[1], sourceMask, read())
  if (upstream !== undefined) {
    const remove = subscribeBinding(upstream, () => slot.set(read()))
    const owner = scopeOwners.get(scope)
    if (owner === undefined) {
      throw new Error(DEV ? 'createCompiledProp received an unknown scope' : 'V003')
    }
    owner[1].add(remove)
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
    const removeUpdater = scope[0](reads, update)
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
    const removeUpdater = scope[0](reads, update)
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
  const scopes = new Set<CompiledScope>()
  activeScopeCollector = scopes
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
  }
}

export function queueElementRef(element: Element, value: unknown): void {
  if (!isRefValue(value)) {
    throw new TypeError(DEV ? 'ref must be a callback or an object with current' : 'V006')
  }
  pendingRefs.set(element, [activeOwner, value])
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
  return [
    STRUCTURAL,
    (parent, before) => {
      if (mounted) throw new Error(DEV ? 'compiled block is already mounted' : 'V008')
      mounted = true
      withScopeNamespace(scope, () => mount(parent, before))
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
  const removers = [scope[0](reads, run)]
  if (additionalScope !== undefined && additionalReads !== undefined) {
    removers.push(additionalScope[0](additionalReads, () => withScopeNamespace(scope, run)))
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
  return [false, new Set()]
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
  activeOwner?.[1].add(cleanup)
}

function disposeOwner(owner: Owner): void {
  if (owner[0]) return
  owner[0] = true
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
    typeof value === 'function' ||
    (typeof value === 'object' && value !== null && 'current' in value)
  )
}

function claimPendingRefOwners(root: Node): void {
  visitElements(root, (element) => {
    const pending = pendingRefs.get(element)
    if (pending !== undefined && pending[0] === null) pending[0] = activeOwner
  })
}

function commitPendingRefs(root: Node): void {
  visitElements(root, (element) => {
    const pending = pendingRefs.get(element)
    if (pending === undefined) return
    pendingRefs.delete(element)
    const owner = pending[0] ?? activeOwner
    const cleanup = attachRef(pending[1], element)
    owner?.[1].add(cleanup)
  })
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
