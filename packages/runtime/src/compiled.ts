import {
  currentIntrinsicNamespace,
  withIntrinsicNamespace,
  type IntrinsicNamespace,
} from './dom/intrinsic.ts'
import {
  HydrationMismatch,
  beginHydration,
  claimHydrationArrayRange,
  claimHydrationComponentMount,
  claimHydrationComponentRange,
  claimHydrationNode,
  claimHydrationSlotRange,
  claimHydrationSuspenseFallback,
  claimHydrationText,
  claimHydrationTextRange,
  hydrationRangeParent,
  hydrationRootMarkers,
  finishHydration,
  finishHydrationArrayRange,
  hydrationCursor,
  hydrationFragmentChildren,
  hydrationInsertionPoint,
  isHydrating,
  isHydrationMismatch,
  noteHydrationStructuralParent,
  withoutHydration,
  withHydrationComponentRange,
  withHydrationInsertion,
  withHydrationCursor,
} from './hydration-bridge.ts'
import { createIndexedList } from './indexed-list.ts'
import { createKeyedList } from './keyed-list.ts'
import { isRenderableProtocol, materializeRenderable } from './renderable-protocol.ts'
import { scheduleDeferredTask, scheduleTask, type CancelScheduledTask } from './scheduler.ts'
import { intersectsSources, isEmptySources, unionSources, type SourceMask } from './source-mask.ts'
import { createStateSlot, type StateSlot } from './state-slot.ts'

const MAX_FLUSH_PASSES = 100
const DEV = typeof __VIDACT_DEV__ === 'undefined' || __VIDACT_DEV__
let retainedUiEnabled = typeof __VIDACT_RETAINED_UI__ !== 'undefined' && __VIDACT_RETAINED_UI__
let profilingEnabled = false
let activeOwnerCount = 0
let createdOwnerCount = 0
const BINDING = Symbol.for('vidact.v1.Binding')
const STRUCTURAL = Symbol.for('vidact.v1.StructuralBinding')
const CONTEXT = Symbol.for('vidact.v1.Context')
const ASYNC_RESOURCE = Symbol.for('vidact.v1.AsyncResource')
const SUSPENSION = Symbol.for('vidact.v1.Suspension')
export const COMPONENT_SPREAD_SOURCE = Symbol.for('vidact.v1.ComponentSpreadSource')
const noop = (): void => {}

type ContextFrame = {
  readonly context: CompiledContext<unknown>
  readonly input: unknown
  readonly parent: ContextFrame | null
}

export type CompiledErrorHandler = (error: unknown) => void

type ErrorBoundaryHandler = {
  readonly handle: (error: unknown) => void
  readonly parent: ErrorBoundaryHandler | null
}

type RootIdentity = {
  mounted: boolean
  nextId: number
  readonly prefix: string
  readonly onCaughtError: CompiledErrorHandler | undefined
  readonly onUncaughtError: CompiledErrorHandler | undefined
}

type PortalPublication = readonly [commit: () => void, rollback: () => void]

type Owner = [
  disposed: boolean,
  cleanups: Set<() => void>,
  context: ContextFrame | null,
  rootIdentity: RootIdentity,
  errorBoundary: ErrorBoundaryHandler | null,
  retainedConnection?: RetainedConnection | null,
  profileContext?: ProfileContext | null,
  debugName?: string | null,
]

type DebugOwnerFrame = {
  readonly name: string
  readonly parent: DebugOwnerFrame | null
  readonly values: unknown[]
}

type ProfileContext = {
  readonly frame: DebugOwnerFrame | null
  readonly boundary: ProfileBoundary | null
}

type ProfileBoundary = {
  readonly parent: ProfileBoundary | null
  id: string
  onRender: ProfilerOnRender
  baseDuration: number
  mounted: boolean
  pendingDuration: number
  pendingStart: number
  scheduled: boolean
}

export type ProfilerPhase = 'mount' | 'update' | 'nested-update'

export type ProfilerOnRender = (
  id: string,
  phase: ProfilerPhase,
  actualDuration: number,
  baseDuration: number,
  startTime: number,
  commitTime: number,
) => void

type RetainedResource = {
  readonly owner: Owner
  readonly connect: () => void
  readonly disconnect: () => void
  active: boolean
  connected: boolean
  disposed: boolean
  readonly phase: number
}

type RetainedConnection = {
  readonly parent: RetainedConnection | null
  readonly children: Set<RetainedConnection>
  readonly resources: Set<RetainedResource>
  readonly deferredFlushes: Map<() => void, CancelScheduledTask>
  readonly afterFlush: Set<() => void>
  visible: boolean
  connected: boolean
  disposed: boolean
}

type AsyncResourceState<Value> = {
  status: 'pending' | 'fulfilled' | 'rejected'
  value: Value | undefined
  reason: unknown
  readonly listeners: Set<() => void>
  readonly cancel: (() => void) | undefined
  subscribers: number
}

export interface AsyncResource<Value> {
  readonly [ASYNC_RESOURCE]: AsyncResourceState<Value>
}

export interface ResourceOptions {
  readonly cancel?: () => void
}

type Suspension = {
  readonly [SUSPENSION]: true
  readonly resource: AsyncResource<unknown>
}

export type LazyModule<Props extends Record<string, unknown>> = {
  readonly default: (props: Props) => CompiledRenderValue
}

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
  hydrationKind?: 'array' | 'slot',
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
    if (isStructuralBinding(child) || isCompiledBinding(child) || isRenderableProtocol(child)) {
      continue
    }
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
  noteHydrationStructuralParent()
  return [
    STRUCTURAL,
    (parent, before) => {
      const hydrated = claimHydrationSlotRange(parent)
      if (hydrated === undefined) insertValue(parent, render(), before)
      else insertValue(parent, render(), hydrated[1])
    },
    'slot',
  ]
}

/** @internal */
export function retainedActivity(
  modeInput: 'visible' | 'hidden' | CompiledBinding<'visible' | 'hidden'>,
  render: () => CompiledRenderValue,
): StructuralBinding {
  noteHydrationStructuralParent()
  const context = activeContextFrame ?? activeOwner?.[2] ?? null
  const rootIdentity = activeOwner?.[3] ?? activeRootIdentity
  if (rootIdentity === null) {
    throw new Error(DEV ? 'Activity must run during compiled root construction' : 'V033')
  }
  const parentErrorBoundary = activeOwner?.[4] ?? null
  const parentConnection = activeOwner?.[5] ?? null
  let mounted = false
  return [
    STRUCTURAL,
    (parent, before) => {
      if (mounted) throw new Error(DEV ? 'compiled Activity is already mounted' : 'V008')
      mounted = true
      const lifetimeOwner = activeOwner
      if (lifetimeOwner === null) {
        throw new Error(DEV ? 'Activity must mount inside an owned compiled root' : 'V033')
      }
      const readMode = (): 'visible' | 'hidden' =>
        validateActivityMode(isCompiledBinding(modeInput) ? modeInput[1]() : modeInput)
      let currentMode = readMode()
      const connection = createRetainedConnection(parentConnection, currentMode === 'visible')
      const childOwner = createOwner(context, rootIdentity, parentErrorBoundary, connection)
      const hydratedRange = claimHydrationSlotRange(parent)
      const start = hydratedRange?.[0] ?? document.createComment(DEV ? 'vidact:activity' : '')
      const end = hydratedRange?.[1] ?? document.createComment(DEV ? '/vidact:activity' : '')
      if (hydratedRange === undefined) {
        parent.insertBefore(start, before)
        parent.insertBefore(end, before)
      }
      const currentParent = rangeParent(start, end, 'Activity boundary')
      const hiddenDisplays = new Map<Element, readonly [string, string]>()
      const hiddenTexts = new Map<Text, Comment>()
      const heldText = document.createDocumentFragment()
      let restoreHydratedDisplays = hydratedRange !== undefined && currentMode === 'hidden'

      const conceal = (): void => {
        for (const node of nodesBetween(start, end)) {
          if (node instanceof Element && 'style' in node) {
            const styled = node as HTMLElement | SVGElement
            const previous = hiddenDisplays.get(node)
            const hydratedDisplay = restoreHydratedDisplays
              ? readServerHiddenDisplay(node)
              : undefined
            if (previous === undefined && hydratedDisplay !== undefined) {
              hiddenDisplays.set(node, hydratedDisplay)
            } else if (
              previous === undefined ||
              styled.style.display !== 'none' ||
              styled.style.getPropertyPriority('display') !== 'important'
            ) {
              hiddenDisplays.set(node, [
                styled.style.display,
                styled.style.getPropertyPriority('display'),
              ])
            }
            styled.style.setProperty('display', 'none', 'important')
          } else if (node instanceof Text && !hiddenTexts.has(node)) {
            const placeholder = document.createComment(DEV ? 'vidact:activity-text' : '')
            node.replaceWith(placeholder)
            heldText.append(node)
            hiddenTexts.set(node, placeholder)
          }
        }
        restoreHydratedDisplays = false
      }
      const reveal = (): void => {
        for (const [element, [display, priority]] of hiddenDisplays) {
          const styled = element as HTMLElement | SVGElement
          if (display === '') styled.style.removeProperty('display')
          else styled.style.setProperty('display', display, priority)
        }
        hiddenDisplays.clear()
        for (const [text, placeholder] of hiddenTexts) {
          if (placeholder.parentNode !== null) placeholder.replaceWith(text)
        }
        hiddenTexts.clear()
      }
      const setMode = (nextMode: 'visible' | 'hidden'): void => {
        if (nextMode === currentMode) return
        currentMode = nextMode
        if (nextMode === 'hidden') {
          connection.visible = false
          updateRetainedConnection(connection)
          conceal()
        } else {
          reveal()
          connection.visible = true
          updateRetainedConnection(connection)
          concealDisconnectedDescendants(connection)
        }
      }

      connection.afterFlush.add(conceal)
      let stagedNodes: readonly Node[] = []
      try {
        const [fragment, nodes] =
          hydratedRange === undefined
            ? stageRender(render, childOwner)
            : withHydrationInsertion(currentParent, end, () => stageRender(render, childOwner))
        stagedNodes = nodes
        currentParent.insertBefore(fragment, end)
        if (currentMode === 'hidden') conceal()
        commitPublishedNodes(nodes)
      } catch (error) {
        disposePublished(childOwner, stagedNodes)
        disposeRetainedConnection(connection)
        throw error
      }
      const removeModeUpdater = isCompiledBinding(modeInput)
        ? subscribeBinding(modeInput, () => setMode(readMode()))
        : noop
      onCleanup(() => {
        removeModeUpdater()
        reveal()
        try {
          disposeRange(childOwner, start, end)
        } finally {
          disposeRetainedConnection(connection)
          start.remove()
          end.remove()
        }
      })
    },
    'slot',
  ]
}

/** @internal */
export function enableRetainedUi(): void {
  retainedUiEnabled = true
}

/** @internal */
export function enableProfiling(): void {
  profilingEnabled = DEV
}

/** @internal */
export function profiled(
  idInput: string | CompiledBinding<string>,
  onRenderInput: ProfilerOnRender | CompiledBinding<ProfilerOnRender>,
  render: () => CompiledRenderValue,
): StructuralBinding {
  if (!DEV) return deferred(render)
  noteHydrationStructuralParent()
  const context = activeContextFrame ?? activeOwner?.[2] ?? null
  const rootIdentity = activeOwner?.[3] ?? activeRootIdentity
  if (rootIdentity === null) {
    throw new Error(DEV ? 'Profiler must run during compiled root construction' : 'V035')
  }
  const parentErrorBoundary = activeOwner?.[4] ?? null
  const parentConnection = activeOwner?.[5] ?? null
  const parentProfile = activeOwner?.[6] ?? null
  let mounted = false
  return [
    STRUCTURAL,
    (parent, before) => {
      if (mounted) throw new Error(DEV ? 'compiled Profiler is already mounted' : 'V008')
      mounted = true
      const readId = (): string => {
        const id = isCompiledBinding(idInput) ? idInput[1]() : idInput
        if (typeof id !== 'string') throw new TypeError('Profiler id must be a string')
        return id
      }
      const readOnRender = (): ProfilerOnRender => {
        const onRender = isCompiledBinding(onRenderInput) ? onRenderInput[1]() : onRenderInput
        if (typeof onRender !== 'function') {
          throw new TypeError('Profiler onRender must be a function')
        }
        return onRender
      }
      const boundary: ProfileBoundary = {
        parent: parentProfile?.boundary ?? null,
        id: readId(),
        onRender: readOnRender(),
        baseDuration: 0,
        mounted: false,
        pendingDuration: 0,
        pendingStart: 0,
        scheduled: false,
      }
      const childOwner = createOwner(context, rootIdentity, parentErrorBoundary, parentConnection, {
        frame: parentProfile?.frame ?? null,
        boundary,
      })
      const hydratedRange = claimHydrationSlotRange(parent)
      const start = hydratedRange?.[0] ?? document.createComment(DEV ? 'vidact:profiler' : '')
      const end = hydratedRange?.[1] ?? document.createComment(DEV ? '/vidact:profiler' : '')
      if (hydratedRange === undefined) {
        parent.insertBefore(start, before)
        parent.insertBefore(end, before)
      }
      const currentParent = rangeParent(start, end, 'Profiler boundary')
      let stagedNodes: readonly Node[] = []
      const started = profileNow()
      try {
        const [fragment, nodes] =
          hydratedRange === undefined
            ? stageRender(render, childOwner)
            : withHydrationInsertion(currentParent, end, () => stageRender(render, childOwner))
        stagedNodes = nodes
        currentParent.insertBefore(fragment, end)
        commitPublishedNodes(nodes)
      } catch (error) {
        disposePublished(childOwner, stagedNodes)
        throw error
      }
      const finished = profileNow()
      boundary.baseDuration = finished - started
      boundary.mounted = true
      emitProfileMeasure(childOwner, 'range', started, finished)
      runOwnerTask(childOwner, () =>
        boundary.onRender(
          boundary.id,
          'mount',
          boundary.baseDuration,
          boundary.baseDuration,
          started,
          finished,
        ),
      )
      const removeIdUpdater = isCompiledBinding(idInput)
        ? subscribeBinding(idInput, () => {
            boundary.id = readId()
          })
        : noop
      const removeCallbackUpdater = isCompiledBinding(onRenderInput)
        ? subscribeBinding(onRenderInput, () => {
            boundary.onRender = readOnRender()
          })
        : noop
      onCleanup(() => {
        removeCallbackUpdater()
        removeIdUpdater()
        disposeRange(childOwner, start, end)
      })
    },
    'slot',
  ]
}

/** @internal */
export function recordCompiledDebugValue<Value>(
  valueInput: Value | CompiledBinding<Value>,
  format?: (value: Value) => unknown,
): void {
  if (!profilingEnabled) return
  const owner = activeConstructionOwner ?? activeOwner
  if (owner === null) {
    throw new Error(DEV ? 'useDebugValue must run inside a compiled component' : 'V036')
  }
  const frame = ensureProfileContext(owner).frame
  if (frame === null) {
    throw new Error(DEV ? 'useDebugValue must run inside a compiled component' : 'V036')
  }
  const read = (): unknown => {
    const value = isCompiledBinding(valueInput) ? valueInput[1]() : valueInput
    return format === undefined ? value : format(value)
  }
  const index = frame.values.length
  frame.values.push(read())
  if (isCompiledBinding(valueInput)) {
    const remove = subscribeBinding(valueInput, () => {
      frame.values[index] = read()
    })
    owner[1].add(remove)
  }
}

/** @internal */
export function captureCompiledOwnerStack(): string | null {
  if (!profilingEnabled) return null
  const owner = activeConstructionOwner ?? activeOwner
  let frame = owner === null ? null : ensureProfileContext(owner).frame
  if (frame === null) return null
  const lines: string[] = []
  while (frame !== null) {
    const values = frame.values.length === 0 ? '' : ` [${frame.values.map(String).join(', ')}]`
    lines.push(`\n    at ${frame.name}${values}`)
    frame = frame.parent
  }
  return lines.join('')
}

function validateActivityMode(mode: unknown): 'visible' | 'hidden' {
  if (mode === 'visible' || mode === 'hidden') return mode
  throw new TypeError(DEV ? 'Activity mode must be "visible" or "hidden"' : 'V034')
}

function readServerHiddenDisplay(element: Element): readonly [string, string] | undefined {
  const cssText = element.getAttribute('style')
  const hiddenDeclaration = 'display:none!important'
  if (cssText === null || !cssText.endsWith(hiddenDeclaration)) return undefined
  let authoredCssText = cssText.slice(0, -hiddenDeclaration.length)
  if (authoredCssText.endsWith(';')) authoredCssText = authoredCssText.slice(0, -1)
  const style = document.createElement('div').style
  style.cssText = authoredCssText
  return [style.display, style.getPropertyPriority('display')]
}

export function errorBoundary(
  render: () => CompiledRenderValue,
  fallback: (error: unknown, reset: () => void) => CompiledRenderValue,
  onError?: CompiledErrorHandler,
): StructuralBinding {
  noteHydrationStructuralParent()
  const context = activeContextFrame ?? activeOwner?.[2] ?? null
  const rootIdentity = activeOwner?.[3] ?? activeRootIdentity
  if (rootIdentity === null) {
    throw new Error(DEV ? 'errorBoundary must run during compiled root construction' : 'V028')
  }
  const parentBoundary = activeOwner?.[4] ?? null
  let mounted = false
  return [
    STRUCTURAL,
    (parent, before) => {
      if (mounted) throw new Error(DEV ? 'compiled error boundary is already mounted' : 'V008')
      mounted = true
      const hydratedRange = claimHydrationSlotRange(parent)
      const start = hydratedRange?.[0] ?? document.createComment(DEV ? 'vidact:error' : '')
      const end = hydratedRange?.[1] ?? document.createComment(DEV ? '/vidact:error' : '')
      if (hydratedRange === undefined) {
        parent.insertBefore(start, before)
        parent.insertBefore(end, before)
      }
      let currentOwner: Owner | null = null
      let currentNodes: readonly Node[] = []
      let failed = false

      const publish = (
        read: () => CompiledRenderValue,
        boundary: ErrorBoundaryHandler | null,
      ): void => {
        const currentParent = rangeParent(start, end, 'error boundary')
        const nextOwner = createOwner(context, rootIdentity, boundary)
        const [fragment, nodes] =
          hydratedRange === undefined
            ? stageRender(read, nextOwner)
            : withHydrationInsertion(currentParent, end, () => stageRender(read, nextOwner))
        try {
          currentParent.insertBefore(fragment, end)
          commitPublishedNodes(nodes)
        } catch (error) {
          disposePublished(nextOwner, nodes)
          throw error
        }
        const previousOwner = currentOwner
        const previousNodes = currentNodes
        currentOwner = nextOwner
        currentNodes = nodes
        disposePublished(previousOwner, previousNodes)
      }

      const reset = (): void => {
        if (!failed) return
        try {
          failed = false
          publish(render, boundary)
        } catch (error) {
          recover(error)
        }
      }
      const recover = (error: unknown): void => {
        failed = true
        publish(() => fallback(error, reset), parentBoundary)
        onError?.(error)
        rootIdentity.onCaughtError?.(error)
      }
      const boundary: ErrorBoundaryHandler = { handle: recover, parent: parentBoundary }

      try {
        publish(render, boundary)
      } catch (error) {
        recover(error)
      }
      onCleanup(() => {
        try {
          disposePublished(currentOwner, currentNodes)
        } finally {
          start.remove()
          end.remove()
        }
      })
    },
    'slot',
  ]
}

export function suspense(
  render: () => CompiledRenderValue,
  fallback: () => CompiledRenderValue,
): StructuralBinding {
  noteHydrationStructuralParent()
  const context = activeContextFrame ?? activeOwner?.[2] ?? null
  const rootIdentity = activeOwner?.[3] ?? activeRootIdentity
  if (rootIdentity === null) {
    throw new Error(DEV ? 'Suspense must run during compiled root construction' : 'V032')
  }
  const parentErrorBoundary = activeOwner?.[4] ?? null
  let mounted = false
  return [
    STRUCTURAL,
    (parent, before) => {
      if (mounted) throw new Error(DEV ? 'compiled Suspense boundary is already mounted' : 'V008')
      mounted = true
      const lifetimeOwner = activeOwner
      if (lifetimeOwner === null) {
        throw new Error(DEV ? 'Suspense must mount inside an owned compiled root' : 'V032')
      }
      const hydratedRange = claimHydrationSlotRange(parent)
      const start = hydratedRange?.[0] ?? document.createComment(DEV ? 'vidact:suspense' : '')
      const end = hydratedRange?.[1] ?? document.createComment(DEV ? '/vidact:suspense' : '')
      if (hydratedRange === undefined) {
        parent.insertBefore(start, before)
        parent.insertBefore(end, before)
      }
      const pendingMarker =
        hydratedRange === undefined ? undefined : claimHydrationSuspenseFallback(parent)
      let currentOwner: Owner | null = null
      let currentNodes: readonly Node[] = []
      let currentKind: 'content' | 'fallback' | null = null
      let removeResourceListener = noop
      let generation = 0
      let boundary: ErrorBoundaryHandler

      const publish = (
        read: () => CompiledRenderValue,
        kind: 'content' | 'fallback',
        detachedHydrationProbe = false,
      ): void => {
        const currentParent = rangeParent(start, end, 'Suspense boundary')
        const nextOwner = createOwner(
          context,
          rootIdentity,
          kind === 'content' ? boundary : parentErrorBoundary,
        )
        const serverNodes = detachedHydrationProbe ? nodesBetween(start, end) : []
        const [fragment, nodes] = detachedHydrationProbe
          ? withoutHydration(() => stageRender(read, nextOwner))
          : hydratedRange === undefined || currentKind !== null
            ? stageRender(read, nextOwner)
            : withHydrationInsertion(currentParent, end, () => stageRender(read, nextOwner))
        try {
          currentParent.insertBefore(fragment, end)
          commitPublishedNodes(nodes)
        } catch (error) {
          disposePublished(nextOwner, nodes)
          throw error
        }
        const previousOwner = currentOwner
        const previousNodes = currentNodes
        currentOwner = nextOwner
        currentNodes = nodes
        currentKind = kind
        disposePublished(previousOwner, previousNodes)
        for (const node of serverNodes) node.parentNode?.removeChild(node)
      }

      const beginAttempt = (): number => {
        const attemptGeneration = ++generation
        removeResourceListener()
        removeResourceListener = noop
        return attemptGeneration
      }

      const suspend = (failure: unknown, attemptGeneration: number): void => {
        if (!isSuspension(failure)) throw failure
        const retry = (): void => {
          if (lifetimeOwner[0] || attemptGeneration !== generation) return
          runOwnerTask(lifetimeOwner, () => attempt(false))
        }
        removeResourceListener = subscribeResource(failure.resource, retry)
        if (currentKind !== 'fallback') {
          try {
            publish(fallback, 'fallback')
            if (pendingMarker !== undefined) {
              currentNodes = [pendingMarker, ...currentNodes]
            }
          } catch (fallbackError) {
            removeResourceListener()
            removeResourceListener = noop
            throw fallbackError
          }
        }
      }

      const attempt = (initial: boolean): void => {
        const attemptGeneration = beginAttempt()
        try {
          publish(render, 'content', initial && pendingMarker !== undefined)
        } catch (error) {
          if (!isSuspension(error)) {
            if (initial || !routeOwnerError(lifetimeOwner, error)) throw error
            return
          }
          suspend(error, attemptGeneration)
        }
      }

      boundary = {
        handle: (error) => suspend(error, beginAttempt()),
        parent: parentErrorBoundary,
      }
      attempt(true)
      onCleanup(() => {
        generation += 1
        removeResourceListener()
        try {
          disposePublished(currentOwner, currentNodes)
        } finally {
          start.remove()
          end.remove()
        }
      })
    },
    'slot',
  ]
}

export function createPortal(
  children: CompiledRenderValue | readonly CompiledRenderValue[],
  container: ParentNode,
  _key?: string | number | bigint | null,
): StructuralBinding {
  if (!(container instanceof Node) || typeof container.insertBefore !== 'function') {
    throw new TypeError(DEV ? 'createPortal requires a DOM container' : 'V026')
  }
  const context = activeContextFrame ?? activeOwner?.[2] ?? null
  const rootIdentity = activeOwner?.[3] ?? activeRootIdentity
  if (rootIdentity === null) {
    throw new Error(DEV ? 'createPortal must run during compiled root construction' : 'V027')
  }
  let mounted = false
  return [
    STRUCTURAL,
    (logicalParent, before) => {
      if (mounted) throw new Error(DEV ? 'compiled portal is already mounted' : 'V008')
      mounted = true
      const logicalMarker = document.createComment(DEV ? 'vidact:portal' : '')
      logicalParent.insertBefore(logicalMarker, before)
      const start = document.createComment(DEV ? 'vidact:portal:start' : '')
      const end = document.createComment(DEV ? 'vidact:portal:end' : '')
      const fragment = document.createDocumentFragment()
      fragment.append(start, end)
      const portalOwner = withRootIdentity(rootIdentity, () =>
        withContextFrame(context, createOwner),
      )
      try {
        withOwner(portalOwner, () => insertValue(fragment, children, end))
      } catch (error) {
        disposeOwner(portalOwner)
        logicalMarker.remove()
        throw error
      }
      const rollback = (): void => {
        removeBetween(start, end)
        start.remove()
        end.remove()
      }
      const publication: PortalPublication = [
        () => {
          container.insertBefore(fragment, null)
          try {
            commitRangeRefs(start, end)
          } catch (error) {
            rollback()
            throw error
          }
        },
        rollback,
      ]
      if (rootIdentity.mounted) {
        stagePublication([publication[0], publication[1], () => disposeOwner(portalOwner)])
      } else {
        let pending = pendingRootPortals.get(rootIdentity)
        if (pending === undefined) {
          pending = new Set()
          pendingRootPortals.set(rootIdentity, pending)
        }
        pending.add(publication)
      }
      onCleanup(() => {
        pendingRootPortals.get(rootIdentity)?.delete(publication)
        try {
          disposeOwner(portalOwner)
        } finally {
          publication[1]()
          logicalMarker.remove()
        }
      })
    },
  ]
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
  errorOwner?: Owner | null | undefined,
]

export type CompiledPropTransition = PublicationOperation

type ComponentRange = readonly [start: Comment, end: Comment, scope: CompiledScope]

let activeOwner: Owner | null = null
let activeContextFrame: ContextFrame | null = null
let activeRootIdentity: RootIdentity | null = null
let nextClientRoot = 0
let activeScopeCollector: Set<CompiledScope> | null = null
let activeConstructionOwner: Owner | null = null
let activeProfileName: string | null = null
let activeErrorOwner: Owner | null = null
let failedOwner: Owner | null = null
let transactionDepth = 0
let drainingFlushes = false
let activePublication: PublicationOperation[] | null = null
const scheduledFlushes = new Set<() => void>()
const scopeOwners = new WeakMap<CompiledScope, Owner>()
const scopeNamespaces = new WeakMap<CompiledScope, IntrinsicNamespace>()
const componentRanges = new WeakMap<CompiledComponentResult, ComponentRange>()
const pendingRefs = new WeakMap<Element, PendingRef>()
const componentCommitOwners = new WeakMap<Comment, Owner>()
const pendingInsertionCommits = new WeakMap<Owner, Set<() => void>>()
const pendingOwnerCommits = new WeakMap<Owner, Set<() => void>>()
const pendingRootPortals = new WeakMap<RootIdentity, Set<PortalPublication>>()
const promiseResources = new WeakMap<object, AsyncResource<unknown>>()

export function createCompiledScope(): CompiledScope {
  return createScope(wideSourceOperations)
}

export function createNarrowCompiledScope(): CompiledScope {
  return createScope(narrowSourceOperations)
}

export function runCompiledTransaction<T>(operation: () => T): T {
  transactionDepth += 1
  try {
    return operation()
  } finally {
    transactionDepth -= 1
    if (transactionDepth === 0) drainFlushes()
  }
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
    const operation = (): void => {
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
            if (profilingEnabled) {
              measureProfileWork(owner, 'updater', () => updater[2](active))
            } else {
              updater[2](active)
            }
            if (updater[1] !== undefined) active = operations[2](active, updater[1])
          }
          addedDuringFlush.clear()
        }
      } finally {
        addedDuringFlush.clear()
        flushing = false
      }
      if (retainedUiEnabled) notifyRetainedFlush(owner[5] ?? null)
    }
    if (profilingEnabled) measureProfileWork(owner, 'scheduler', operation, true)
    else operation()
  }

  const scope: CompiledScope = [
    (reads, run, writes) => {
      if (owner[0]) {
        throw new Error(DEV ? 'cannot add an updater to a disposed scope' : 'V002')
      }
      const errorOwner = activeOwner ?? owner
      const context = activeContextFrame ?? errorOwner[2]
      const entry: CompiledUpdater = [
        reads,
        writes,
        (active) => {
          try {
            withOwner(errorOwner, () =>
              withContextFrame(context, () => withScopeNamespace(scope, () => run(active))),
            )
          } catch (error) {
            if (!routeOwnerError(errorOwner, error)) {
              failedOwner = errorOwner
              throw error
            }
          }
        },
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
      if (batchDepth === 0) {
        if (retainedUiEnabled) scheduleOwnerFlush(owner, flush)
        else scheduleFlush(flush)
      }
    },
    <T>(operation: () => T): T => {
      batchDepth += 1
      transactionDepth += 1
      try {
        return operation()
      } finally {
        batchDepth -= 1
        if (batchDepth === 0 && !operations[0](pending)) {
          if (retainedUiEnabled) scheduleOwnerFlush(owner, flush)
          else scheduleFlush(flush)
        }
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

/** @internal */
export function runWithCompiledContext<Value, Result>(
  context: CompiledContext<Value>,
  value: Value | CompiledBinding<Value>,
  operation: () => Result,
): Result {
  const parent = activeContextFrame ?? activeOwner?.[2] ?? null
  return withContextFrame(
    { context: context as CompiledContext<unknown>, input: value, parent },
    operation,
  )
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
  if (!retainedUiEnabled) {
    let active = true
    const checkSnapshot = (): void => {
      if (!active) return
      scope[2](() => slot.replace(getSnapshot()))
    }
    const unsubscribe = storeSubscribe(() => runOwnerTask(owner, checkSnapshot))
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
  let active = false
  let unsubscribe = noop
  const checkSnapshot = (): void => {
    if (!active) return
    scope[2](() => slot.replace(getSnapshot()))
  }
  const [activate, disposeResource] = createRetainedResource(
    owner,
    () => {
      active = true
      try {
        const remove = storeSubscribe(() => runOwnerTask(owner, checkSnapshot))
        if (typeof remove !== 'function') {
          throw new TypeError(
            DEV ? 'external store subscribe must return an unsubscribe function' : 'V020',
          )
        }
        unsubscribe = remove
        checkSnapshot()
      } catch (error) {
        active = false
        unsubscribe()
        unsubscribe = noop
        throw error
      }
    },
    () => {
      active = false
      unsubscribe()
      unsubscribe = noop
    },
    0,
  )
  try {
    activate()
  } catch (error) {
    disposeResource()
    throw error
  }
  owner[1].add(() => {
    disposeResource()
  })
  return slot
}

export function createCompiledEffectEvent<Arguments extends unknown[], Result>(
  scope: CompiledScope,
  callback: (...arguments_: Arguments) => Result,
): (...arguments_: Arguments) => Result {
  const owner = scopeOwners.get(scope)
  if (owner === undefined) {
    throw new Error(DEV ? 'createCompiledEffectEvent received an unknown scope' : 'V003')
  }
  return (...arguments_) => {
    if (owner[0]) throw new Error(DEV ? 'cannot call an effect event after disposal' : 'V022')
    return callback(...arguments_)
  }
}

export function createCompiledId(scope: CompiledScope): string {
  const owner = scopeOwners.get(scope)
  if (owner === undefined) {
    throw new Error(DEV ? 'createCompiledId received an unknown scope' : 'V003')
  }
  const id = `:${owner[3].prefix}r${owner[3].nextId}:`
  owner[3].nextId += 1
  return id
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

export function createResource<Value>(
  input: PromiseLike<Value>,
  options: ResourceOptions = {},
): AsyncResource<Value> {
  if (!isPromiseLike(input)) {
    throw new TypeError(DEV ? 'createResource requires a promise-like value' : 'V029')
  }
  const existing = promiseResources.get(input as object) as AsyncResource<Value> | undefined
  if (existing !== undefined) return existing
  const state: AsyncResourceState<Value> = {
    status: 'pending',
    value: undefined,
    reason: undefined,
    listeners: new Set(),
    cancel: options.cancel,
    subscribers: 0,
  }
  const resource: AsyncResource<Value> = { [ASYNC_RESOURCE]: state }
  promiseResources.set(input as object, resource as AsyncResource<unknown>)
  void Promise.resolve(input).then(
    (value) => settleResource(state, 'fulfilled', value),
    (reason: unknown) => settleResource(state, 'rejected', reason),
  )
  return resource
}

export function useAsync<Value>(
  input: CompiledContext<Value> | AsyncResource<Value> | PromiseLike<Value>,
): Value {
  if (isCompiledContext<Value>(input)) return useContext(input)
  return readResource(
    isAsyncResource<Value>(input) ? input : createResource(input as PromiseLike<Value>),
  )
}

export function createCompiledAsync<Value>(
  scope: CompiledScope,
  reads: SourceMask,
  writes: SourceMask,
  evaluate: () => CompiledContext<Value> | AsyncResource<Value> | PromiseLike<Value>,
): StateSlot<Value> {
  const input = evaluate()
  if (isCompiledContext<Value>(input)) return createCompiledContext(scope, writes, input)
  const slot = createCompiledState(scope, writes, useAsync(input))
  scope[0](reads, () => slot.replace(useAsync(evaluate())))
  return slot
}

export function lazy<Props extends Record<string, unknown>>(
  load: () => PromiseLike<LazyModule<Props>>,
): (props: Props) => CompiledRenderValue {
  let resource: AsyncResource<LazyModule<Props>> | undefined
  return (props) => {
    resource ??= createResource(load())
    const module = readResource(resource)
    if (typeof module?.default !== 'function') {
      throw new TypeError(DEV ? 'lazy loader must resolve to a default component export' : 'V030')
    }
    return module.default(props)
  }
}

export function Suspense(props: {
  readonly children?: (() => CompiledRenderValue) | readonly [() => CompiledRenderValue] | undefined
  readonly fallback: () => CompiledRenderValue
}): StructuralBinding {
  const render = Array.isArray(props.children) ? props.children[0] : props.children
  if (typeof render !== 'function' || typeof props.fallback !== 'function') {
    throw new TypeError(
      DEV
        ? `Suspense children and fallback must be compiler-generated render functions; received ${typeof render} and ${typeof props.fallback}`
        : 'V031',
    )
  }
  return suspense(render, props.fallback)
}

export function useSyncExternalStore<T>(
  _subscribe: (onStoreChange: () => void) => () => void,
  _getSnapshot: () => T,
  _getServerSnapshot?: () => T,
): T {
  throw new Error(DEV ? 'useSyncExternalStore requires compiler lowering' : 'V021')
}

export function useEffectEvent<Arguments extends unknown[], Result>(
  callback: (...arguments_: Arguments) => Result,
): (...arguments_: Arguments) => Result {
  return callback
}

export function useId(): string {
  if (activeConstructionOwner === null) {
    throw new Error(DEV ? 'useId must run during compiled component construction' : 'V023')
  }
  const id = `:${activeConstructionOwner[3].prefix}r${activeConstructionOwner[3].nextId}:`
  activeConstructionOwner[3].nextId += 1
  return id
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

export function compiledEvent<Arguments extends unknown[]>(
  scope: CompiledScope,
  handler: (...arguments_: Arguments) => void,
): (...arguments_: Arguments) => void {
  const owner = scopeOwners.get(scope)
  if (owner === undefined) {
    throw new Error(DEV ? 'compiledEvent received an unknown scope' : 'V003')
  }
  const errorOwner = activeOwner ?? owner
  return (...arguments_) =>
    runOwnerTask(errorOwner, () =>
      withOwner(errorOwner, () => scope[2](() => handler(...arguments_))),
    )
}

export interface CompiledTaskController {
  readonly disposed: () => boolean
  readonly report: (error: unknown) => void
}

export function captureCompiledTask(scope?: CompiledScope): CompiledTaskController {
  const owner = scope === undefined ? activeOwner : scopeOwners.get(scope)
  if (owner === null || owner === undefined) {
    throw new Error(DEV ? 'compiled task must be captured during owned construction' : 'V034')
  }
  return {
    disposed: () => owner[0],
    report: (error) =>
      runOwnerTask(owner, () => {
        throw error
      }),
  }
}

export function when(
  scope: CompiledScope,
  reads: SourceMask,
  condition: () => unknown,
  render: () => RenderValue,
  additionalScope?: CompiledScope,
  additionalReads?: SourceMask,
): StructuralBinding {
  return structural(
    scope,
    (parent, before) => {
      const [start, end, hydrated] = structuralRange(parent, before, 'when')
      let branchOwner: Owner | null = null
      let mounted = false
      let hydrationPending = hydrated

      const update = (): void => {
        const next = Boolean(condition())
        if (hydrationPending && !next) {
          claimHydrationText(parent, '')
          hydrationPending = false
          return
        }
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
        const [fragment, staged] = hydrationPending
          ? withHydrationInsertion(currentParent, end, () => stageRender(render, nextOwner))
          : stageRender(render, nextOwner)
        hydrationPending = false
        currentParent.insertBefore(fragment, end)
        commitPublishedNodes(staged)
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
    },
    'slot',
  )
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
  return structural(
    scope,
    (parent, before) => {
      const [start, end, hydrated] = structuralRange(parent, before, 'choice')
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
        const [fragment, nodes] =
          hydrated && selected === -1
            ? withHydrationInsertion(currentParent, end, () =>
                stageRender(next === 0 ? consequent : alternate, nextOwner),
              )
            : stageRender(next === 0 ? consequent : alternate, nextOwner)
        currentParent.insertBefore(fragment, end)
        try {
          commitPublishedNodes(nodes)
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
    },
    'slot',
  )
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
  return structural(
    scope,
    (parent, before) => {
      const [start, end, hydrated] = structuralRange(parent, before, 'dispatch')
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
        const [fragment, nodes] =
          hydrated && currentType === unset
            ? withHydrationInsertion(currentParent, end, () => stageRender(render, nextOwner))
            : stageRender(render, nextOwner)
        currentParent.insertBefore(fragment, end)
        try {
          commitPublishedNodes(nodes)
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
    },
    'slot',
  )
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
  return structural(
    scope,
    (parent, before) => {
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
          commitPublishedNodes(list.update(values()))
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
    },
    'array',
  )
}

export function indexed<T>(
  scope: CompiledScope,
  reads: SourceMask,
  values: () => readonly T[],
  render: (value: StateSlot<T>, index: StateSlot<number>, itemScope: CompiledScope) => RenderValue,
  additionalScope?: CompiledScope,
  additionalReads?: SourceMask,
): StructuralBinding {
  return structural(
    scope,
    (parent, before) => {
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
          commitPublishedNodes(list.update(values()))
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
    },
    'array',
  )
}

export function compiledRoot(
  scope: CompiledScope,
  render: () => CompiledRenderValue,
): CompiledComponentResult {
  const owner = scopeOwners.get(scope)
  if (owner === undefined) {
    throw new Error(DEV ? 'compiledRoot received an unknown scope' : 'V004')
  }
  const hydratedRange = claimHydrationComponentRange()
  const start = hydratedRange?.[0] ?? document.createComment(DEV ? 'vidact:component' : '')
  const end = hydratedRange?.[1] ?? document.createComment(DEV ? '/vidact:component' : '')
  componentCommitOwners.set(end, owner)
  const fragment = document.createDocumentFragment()
  if (hydratedRange === undefined) fragment.append(start, end)
  owner[1].add(() => {
    try {
      removeBetween(start, end)
    } finally {
      start.remove()
      end.remove()
    }
  })

  try {
    const renderParent = hydrationRangeParent(start, end) ?? fragment
    const insertRender = () =>
      withOwner(owner, () =>
        withScopeNamespace(scope, () => insertValue(renderParent, render(), end)),
      )
    const insert = () => {
      if (hydratedRange === undefined) insertRender()
      else
        withHydrationComponentRange(hydratedRange, () =>
          withHydrationCursor(renderParent, start.nextSibling, insertRender),
        )
    }
    if (profilingEnabled) measureProfileWork(owner, 'range', insert)
    else insert()
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
        if (!claimHydrationComponentMount(parent, start, end)) {
          parent.insertBefore(fragment, before)
        }
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

export function constructCompiledComponent<T extends CompiledRenderValue>(
  component: () => T,
  componentType?: unknown,
): T {
  const previousCollector = activeScopeCollector
  const previousConstructionOwner = activeConstructionOwner
  const previousProfileName = activeProfileName
  const scopes = new Set<CompiledScope>()
  activeScopeCollector = scopes
  activeConstructionOwner = null
  const profileType = componentType as
    | { readonly name?: string; readonly displayName?: string }
    | undefined
  if (DEV) activeProfileName = profileType?.displayName ?? profileType?.name ?? 'Anonymous'
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
    if (DEV) activeProfileName = previousProfileName
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

export function useInsertionEffect(
  create: () => EffectResult,
  dependencies?: readonly unknown[],
): void {
  const owner = activeConstructionOwner
  if (owner === null) {
    throw new Error(
      DEV ? 'insertion effects must run during compiled component construction' : 'V016',
    )
  }
  if (dependencies !== undefined && dependencies.length !== 0) {
    throw new Error(
      DEV ? 'reactive insertion effect dependencies require compiler lowering' : 'V017',
    )
  }
  const lifetimeOwner = activeOwner ?? owner
  if (!retainedUiEnabled) {
    let cleanup = noop
    queueInsertionCommit(owner, () => {
      if (lifetimeOwner[0]) return
      cleanup()
      cleanup = profilingEnabled
        ? readProfiledEffectCleanup(owner, create)
        : readEffectCleanup(create())
    })
    lifetimeOwner[1].add(() => cleanup())
    return
  }
  let cleanup = noop
  const [activate, disposeResource] = createRetainedResource(
    lifetimeOwner,
    () => {
      stagePublication([
        noop,
        noop,
        undefined,
        () => {
          cleanup = profilingEnabled
            ? readProfiledEffectCleanup(owner, create)
            : readEffectCleanup(create())
        },
        -20,
      ])
    },
    () => {
      cleanup()
      cleanup = noop
    },
  )
  queueInsertionCommit(owner, () => {
    if (!lifetimeOwner[0]) activate()
  })
  lifetimeOwner[1].add(disposeResource)
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
  const lifetimeOwner = activeOwner ?? owner
  if (!retainedUiEnabled) {
    let cleanup = noop
    let generation = 0
    const run = (): void => {
      cleanup()
      cleanup = profilingEnabled
        ? readProfiledEffectCleanup(owner, create)
        : readEffectCleanup(create())
    }
    queueOwnerCommit(owner, () => {
      if (lifetimeOwner[0]) return
      if (passive) {
        const scheduled = ++generation
        ;(DEV ? scheduleTask : queueMicrotask)(() => {
          if (!lifetimeOwner[0] && scheduled === generation) runOwnerTask(lifetimeOwner, run)
        })
      } else {
        run()
      }
    })
    lifetimeOwner[1].add(() => {
      generation += 1
      if (passive) (DEV ? scheduleTask : queueMicrotask)(() => runOwnerTask(lifetimeOwner, cleanup))
      else cleanup()
    })
    return
  }
  let cleanup = noop
  let generation = 0
  const [activate, disposeResource] = createRetainedResource(
    lifetimeOwner,
    () => {
      stagePublication([
        noop,
        noop,
        undefined,
        () => {
          if (passive) {
            const scheduled = ++generation
            ;(DEV ? scheduleTask : queueMicrotask)(() => {
              if (!lifetimeOwner[0] && scheduled === generation) {
                runOwnerTask(lifetimeOwner, () => {
                  cleanup = profilingEnabled
                    ? readProfiledEffectCleanup(owner, create)
                    : readEffectCleanup(create())
                })
              }
            })
          } else {
            cleanup = profilingEnabled
              ? readProfiledEffectCleanup(owner, create)
              : readEffectCleanup(create())
          }
        },
        passive ? 40 : 20,
      ])
    },
    () => {
      generation += 1
      const previousCleanup = cleanup
      cleanup = noop
      if (passive)
        (DEV ? scheduleTask : queueMicrotask)(() => runOwnerTask(lifetimeOwner, previousCleanup))
      else previousCleanup()
    },
  )
  queueOwnerCommit(owner, () => {
    if (!lifetimeOwner[0]) activate()
  })
  lifetimeOwner[1].add(disposeResource)
}

export function compiledLayoutEffect(
  scope: CompiledScope,
  reads: SourceMask,
  readCreate: () => () => EffectResult,
  readDependencies?: () => readonly unknown[],
): void {
  compiledEffect(scope, reads, readCreate, readDependencies, false)
}

export function compiledInsertionEffect(
  scope: CompiledScope,
  reads: SourceMask,
  readCreate: () => () => EffectResult,
  readDependencies?: () => readonly unknown[],
): void {
  const owner = activeConstructionOwner
  if (owner === null || scopeOwners.get(scope) !== owner) {
    throw new Error(DEV ? 'compiled insertion effects must run in their component scope' : 'V016')
  }
  const lifetimeOwner = activeOwner ?? owner
  if (!retainedUiEnabled) {
    let mounted = false
    let currentDependencies: readonly unknown[] | undefined
    let cleanup = noop
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
      cleanup = profilingEnabled
        ? readProfiledEffectCleanup(owner, () => readCreate()())
        : readEffectCleanup(readCreate()())
      currentDependencies = nextDependencies
      mounted = true
    }
    queueInsertionCommit(owner, () => {
      if (!lifetimeOwner[0]) run()
    })
    const removeUpdater = subscribe(scope, reads, () =>
      stagePublication([noop, noop, undefined, run, -20]),
    )
    lifetimeOwner[1].add(() => {
      removeUpdater()
      cleanup()
    })
    return
  }
  let mounted = false
  let connected = false
  let currentDependencies: readonly unknown[] | undefined
  let cleanup = noop
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
    cleanup = profilingEnabled
      ? readProfiledEffectCleanup(owner, () => readCreate()())
      : readEffectCleanup(readCreate()())
    currentDependencies = nextDependencies
    mounted = true
  }
  const [activate, disposeResource] = createRetainedResource(
    lifetimeOwner,
    () => {
      stagePublication([
        noop,
        noop,
        undefined,
        () => {
          connected = true
          run()
        },
        -20,
      ])
    },
    () => {
      connected = false
      cleanup()
      cleanup = noop
      mounted = false
    },
  )
  queueInsertionCommit(owner, () => {
    if (!lifetimeOwner[0]) activate()
  })
  const removeUpdater = subscribe(scope, reads, () => {
    if (connected) stagePublication([noop, noop, undefined, run, -20])
  })
  lifetimeOwner[1].add(() => {
    removeUpdater()
    disposeResource()
  })
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
  const lifetimeOwner = activeOwner ?? owner
  if (!retainedUiEnabled) {
    let mounted = false
    let generation = 0
    let currentDependencies: readonly unknown[] | undefined
    let cleanup = noop
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
      cleanup = profilingEnabled
        ? readProfiledEffectCleanup(owner, () => readCreate()())
        : readEffectCleanup(readCreate()())
      currentDependencies = nextDependencies
      mounted = true
    }
    const schedule = (): void => {
      if (!passive) {
        run()
        return
      }
      const scheduled = ++generation
      ;(DEV ? scheduleTask : queueMicrotask)(() => {
        if (!lifetimeOwner[0] && scheduled === generation) runOwnerTask(lifetimeOwner, run)
      })
    }
    queueOwnerCommit(owner, () => {
      if (!lifetimeOwner[0]) schedule()
    })
    const removeUpdater = subscribe(scope, reads, () => {
      if (passive) schedule()
      else stagePublication([noop, noop, undefined, run, 20])
    })
    lifetimeOwner[1].add(() => {
      generation += 1
      removeUpdater()
      if (passive) (DEV ? scheduleTask : queueMicrotask)(() => runOwnerTask(lifetimeOwner, cleanup))
      else cleanup()
    })
    return
  }
  let mounted = false
  let connected = false
  let generation = 0
  let currentDependencies: readonly unknown[] | undefined
  let cleanup = noop
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
    cleanup = profilingEnabled
      ? readProfiledEffectCleanup(owner, () => readCreate()())
      : readEffectCleanup(readCreate()())
    currentDependencies = nextDependencies
    mounted = true
  }
  const schedule = (): void => {
    if (!connected) return
    if (!passive) {
      run()
      return
    }
    const scheduled = ++generation
    ;(DEV ? scheduleTask : queueMicrotask)(() => {
      if (!lifetimeOwner[0] && scheduled === generation) runOwnerTask(lifetimeOwner, run)
    })
  }
  const [activate, disposeResource] = createRetainedResource(
    lifetimeOwner,
    () => {
      stagePublication([
        noop,
        noop,
        undefined,
        () => {
          connected = true
          schedule()
        },
        passive ? 40 : 20,
      ])
    },
    () => {
      connected = false
      generation += 1
      const previousCleanup = cleanup
      cleanup = noop
      mounted = false
      if (passive)
        (DEV ? scheduleTask : queueMicrotask)(() => runOwnerTask(lifetimeOwner, previousCleanup))
      else previousCleanup()
    },
  )
  queueOwnerCommit(owner, () => {
    if (!lifetimeOwner[0]) activate()
  })
  const removeUpdater = subscribe(scope, reads, () => {
    if (!connected) return
    if (passive) schedule()
    else stagePublication([noop, noop, undefined, run, 20])
  })
  lifetimeOwner[1].add(() => {
    removeUpdater()
    disposeResource()
  })
}

function readEffectCleanup(result: EffectResult): () => void {
  if (result === undefined) return noop
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
  let cleanup = noop

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
      noop,
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

function queueInsertionCommit(owner: Owner, commit: () => void): void {
  let commits = pendingInsertionCommits.get(owner)
  if (commits === undefined) {
    commits = new Set()
    pendingInsertionCommits.set(owner, commits)
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
  let cleanup = noop
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

export interface MountCompiledOptions {
  readonly identifierPrefix?: string
  readonly onCaughtError?: CompiledErrorHandler
  readonly onRecoverableError?: CompiledErrorHandler
  readonly onUncaughtError?: CompiledErrorHandler
}

export function hydrateCompiled(
  component: () => CompiledComponentResult,
  host: ParentNode,
  options?: MountCompiledOptions,
): { dispose: () => void } {
  let endHydration: (() => void) | undefined
  let hydratedMount: { dispose: () => void } | undefined
  try {
    endHydration = beginHydration(host)
    hydratedMount = mountCompiled(component, host, options)
    finishHydration()
    const rootMarkers = hydrationRootMarkers()
    return {
      dispose: () => {
        try {
          hydratedMount?.dispose()
        } finally {
          removeBetween(rootMarkers[0], rootMarkers[1])
          rootMarkers[0].remove()
          rootMarkers[1].remove()
        }
      },
    }
  } catch (error) {
    if (!isHydrationMismatch(error)) throw error
    try {
      hydratedMount?.dispose()
    } catch {
      // Preserve and report the mismatch that forced recovery.
    }
    hydratedMount = undefined
    endHydration?.()
    endHydration = undefined
    options?.onRecoverableError?.(error)
    return mountCompiled(component, host, options)
  } finally {
    endHydration?.()
  }
}

export function mountCompiled(
  component: () => CompiledComponentResult,
  host: ParentNode,
  options?: MountCompiledOptions,
): { dispose: () => void } {
  const hydrating = isHydrating()
  const previousRootIdentity = activeRootIdentity
  const rootIdentity = createRootIdentity(
    options?.identifierPrefix,
    options?.onCaughtError,
    options?.onUncaughtError,
  )
  activeRootIdentity = rootIdentity
  let root: CompiledComponentResult
  try {
    root = constructCompiledComponent(component)
  } catch (error) {
    if (isHydrationMismatch(error)) throw error
    if (rootIdentity.onUncaughtError === undefined) throw error
    rootIdentity.onUncaughtError(error)
    return { dispose: noop }
  } finally {
    activeRootIdentity = previousRootIdentity
  }
  const range = componentRanges.get(root)
  if (range === undefined) {
    throw new Error(DEV ? 'mountCompiled received an unknown component result' : 'V007')
  }
  const previous = [...host.childNodes]
  try {
    root[1](host, previous[0] ?? null)
    const rootOwner = scopeOwners.get(range[2])
    const mountedRootIdentity = rootOwner?.[3]
    if (mountedRootIdentity !== undefined) {
      mountedRootIdentity.mounted = true
      commitRootPortals(mountedRootIdentity)
    }
    commitOwnerInsertions(rootOwner)
    commitRangeRefs(range[0], range[1])
    commitOwnerResources(rootOwner)
    if (!hydrating) {
      for (const node of previous) host.removeChild(node)
    }
  } catch (error) {
    try {
      range[2][3]()
    } catch {
      // Preserve the mount error while still running every component cleanup.
    }
    if (isHydrationMismatch(error) || rootIdentity.onUncaughtError === undefined) throw error
    rootIdentity.onUncaughtError(error)
    return { dispose: noop }
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

function structural(
  scope: CompiledScope,
  mount: StructuralBinding[1],
  hydrationKind?: StructuralBinding[2],
): StructuralBinding {
  if (hydrationKind !== undefined) noteHydrationStructuralParent()
  let mounted = false
  const owner = activeOwner ?? scopeOwners.get(scope)!
  const context = activeContextFrame ?? owner[2]
  const mountOnce: StructuralBinding[1] = (parent, before) => {
    if (mounted) throw new Error(DEV ? 'compiled block is already mounted' : 'V008')
    mounted = true
    const operation = () =>
      withOwner(owner, () =>
        withContextFrame(context, () => withScopeNamespace(scope, () => mount(parent, before))),
      )
    if (profilingEnabled) measureProfileWork(owner, 'range', operation)
    else operation()
  }
  return hydrationKind === undefined
    ? [STRUCTURAL, mountOnce]
    : [STRUCTURAL, mountOnce, hydrationKind]
}

function structuralRange(
  parent: Node,
  before: Node | null,
  label: string,
): readonly [start: Comment, end: Comment, hydrated: boolean] {
  const hydrated = claimHydrationSlotRange(parent)
  if (hydrated !== undefined) return [hydrated[0], hydrated[1], true]
  const start = document.createComment(DEV ? `vidact:${label}` : '')
  const end = document.createComment(DEV ? `/vidact:${label}` : '')
  parent.insertBefore(start, before)
  parent.insertBefore(end, before)
  return [start, end, false]
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

function createOwner(
  context = activeContextFrame ?? activeOwner?.[2] ?? null,
  rootIdentity = activeOwner?.[3] ?? activeRootIdentity ?? createRootIdentity(),
  boundary = activeOwner?.[4] ?? null,
  retainedConnection = activeOwner?.[5] ?? null,
  profileContext = activeOwner?.[6] ?? activeConstructionOwner?.[6] ?? null,
): Owner {
  if (DEV) {
    activeOwnerCount += 1
    createdOwnerCount += 1
  }
  let nextProfile = profileContext
  if (profilingEnabled && activeProfileName !== null && activeConstructionOwner === null) {
    nextProfile = {
      frame: {
        name: activeProfileName,
        parent: profileContext?.frame ?? null,
        values: [],
      },
      boundary: profileContext?.boundary ?? null,
    }
  }
  if (profilingEnabled) {
    const owner: Owner = [
      false,
      new Set(),
      context,
      rootIdentity,
      boundary,
      retainedUiEnabled ? retainedConnection : null,
      nextProfile,
    ]
    if (DEV) owner[7] = activeConstructionOwner?.[7] ?? activeProfileName
    return owner
  }
  const owner: Owner = retainedUiEnabled
    ? [false, new Set(), context, rootIdentity, boundary, retainedConnection]
    : [false, new Set(), context, rootIdentity, boundary]
  if (DEV) owner[7] = activeConstructionOwner?.[7] ?? activeProfileName
  return owner
}

function ensureProfileContext(owner: Owner): ProfileContext {
  const current = owner[6]
  if (current?.frame !== null && current?.frame !== undefined) return current
  const parent =
    current ?? (activeOwner !== null && activeOwner !== owner ? (activeOwner[6] ?? null) : null)
  const next = {
    frame: {
      name: owner[7] ?? activeProfileName ?? 'Anonymous',
      parent: parent?.frame ?? null,
      values: [],
    },
    boundary: parent?.boundary ?? null,
  }
  owner[6] = next
  return next
}

function profileNow(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

function measureProfileWork<Result>(
  owner: Owner,
  kind: 'effect' | 'range' | 'scheduler' | 'updater',
  operation: () => Result,
  contribute = false,
): Result {
  const started = profileNow()
  try {
    return operation()
  } finally {
    const finished = profileNow()
    emitProfileMeasure(owner, kind, started, finished)
    if (contribute) recordProfileCommit(owner, started, finished)
  }
}

function emitProfileMeasure(
  owner: Owner,
  kind: 'effect' | 'range' | 'scheduler' | 'updater',
  started: number,
  finished: number,
): void {
  if (typeof performance === 'undefined' || typeof performance.measure !== 'function') return
  const component = owner[6]?.frame?.name ?? 'Anonymous'
  performance.measure(`vidact.${kind}:${component}`, { start: started, end: finished })
}

function recordProfileCommit(owner: Owner, started: number, finished: number): void {
  let boundary = owner[6]?.boundary ?? null
  while (boundary !== null) {
    queueProfileBoundaryCommit(boundary, owner, started, finished)
    boundary = boundary.parent
  }
}

function queueProfileBoundaryCommit(
  boundary: ProfileBoundary,
  owner: Owner,
  started: number,
  finished: number,
): void {
  if (!boundary.mounted) return
  boundary.pendingDuration += finished - started
  boundary.pendingStart =
    boundary.pendingStart === 0 ? started : Math.min(boundary.pendingStart, started)
  if (boundary.scheduled) return
  boundary.scheduled = true
  stagePublication([
    noop,
    noop,
    undefined,
    () => {
      const actualDuration = boundary.pendingDuration
      const startTime = boundary.pendingStart
      boundary.pendingDuration = 0
      boundary.pendingStart = 0
      boundary.scheduled = false
      boundary.onRender(
        boundary.id,
        'update',
        actualDuration,
        boundary.baseDuration,
        startTime,
        profileNow(),
      )
    },
    100,
    owner,
  ])
}

function readProfiledEffectCleanup(owner: Owner, evaluate: () => EffectResult): () => void {
  const cleanup = measureProfileWork(owner, 'effect', () => readEffectCleanup(evaluate()))
  if (cleanup === noop) return cleanup
  return () => measureProfileWork(owner, 'effect', cleanup)
}

function createRetainedConnection(
  parent: RetainedConnection | null,
  visible: boolean,
): RetainedConnection {
  const connection: RetainedConnection = {
    parent,
    children: new Set(),
    resources: new Set(),
    deferredFlushes: new Map(),
    afterFlush: new Set(),
    visible,
    connected: visible && (parent?.connected ?? true),
    disposed: false,
  }
  parent?.children.add(connection)
  return connection
}

function createRetainedResource(
  owner: Owner,
  connect: () => void,
  disconnect: () => void,
  phase = 1,
): readonly [activate: () => void, dispose: () => void] {
  const connection = owner[5]
  const resource: RetainedResource = {
    owner,
    connect,
    disconnect,
    active: false,
    connected: false,
    disposed: false,
    phase,
  }
  connection?.resources.add(resource)
  const activate = (): void => {
    if (resource.disposed) return
    resource.active = true
    reconcileRetainedResource(resource, connection?.connected ?? true)
  }
  const dispose = (): void => {
    if (resource.disposed) return
    resource.disposed = true
    resource.active = false
    connection?.resources.delete(resource)
    reconcileRetainedResource(resource, false)
  }
  return [activate, dispose]
}

function reconcileRetainedResource(resource: RetainedResource, connected: boolean): void {
  const nextConnected = !resource.disposed && resource.active && connected
  if (resource.connected === nextConnected) return
  resource.connected = nextConnected
  try {
    runOwnerTask(resource.owner, nextConnected ? resource.connect : resource.disconnect)
  } catch (error) {
    resource.connected = false
    throw error
  }
}

function updateRetainedConnection(connection: RetainedConnection): void {
  if (connection.disposed) return
  const nextConnected = connection.visible && (connection.parent?.connected ?? true)
  if (connection.connected === nextConnected) return
  connection.connected = nextConnected
  if (nextConnected) {
    for (const [flush, cancel] of connection.deferredFlushes) {
      cancel()
      scheduleFlush(flush)
    }
    connection.deferredFlushes.clear()
    for (const resource of [...connection.resources].toSorted(
      (left, right) => left.phase - right.phase,
    )) {
      reconcileRetainedResource(resource, true)
    }
  } else {
    for (const resource of [...connection.resources].toReversed()) {
      reconcileRetainedResource(resource, false)
    }
  }
  for (const child of connection.children) updateRetainedConnection(child)
}

function concealDisconnectedDescendants(connection: RetainedConnection): void {
  for (const child of connection.children) {
    if (!child.connected) {
      for (const conceal of child.afterFlush) conceal()
    }
    concealDisconnectedDescendants(child)
  }
}

function disposeRetainedConnection(connection: RetainedConnection): void {
  if (connection.disposed) return
  connection.disposed = true
  connection.parent?.children.delete(connection)
  for (const cancel of connection.deferredFlushes.values()) cancel()
  connection.deferredFlushes.clear()
  connection.afterFlush.clear()
  for (const child of connection.children) disposeRetainedConnection(child)
  connection.children.clear()
  for (const resource of [...connection.resources].toReversed()) {
    resource.disposed = true
    resource.active = false
    reconcileRetainedResource(resource, false)
  }
  connection.resources.clear()
}

function notifyRetainedFlush(connection: RetainedConnection | null): void {
  for (let current = connection; current !== null; current = current.parent) {
    if (!current.connected) {
      for (const notify of current.afterFlush) notify()
    }
  }
}

function createRootIdentity(
  identifierPrefix?: string,
  onCaughtError?: CompiledErrorHandler,
  onUncaughtError?: CompiledErrorHandler,
): RootIdentity {
  return {
    mounted: false,
    nextId: 0,
    prefix: identifierPrefix ?? `v${nextClientRoot++}-`,
    onCaughtError,
    onUncaughtError,
  }
}

function commitRootPortals(rootIdentity: RootIdentity): void {
  const pending = pendingRootPortals.get(rootIdentity)
  if (pending === undefined) return
  pendingRootPortals.delete(rootIdentity)
  const committed: PortalPublication[] = []
  try {
    for (const publication of pending) {
      publication[0]()
      committed.push(publication)
    }
  } catch (error) {
    for (const publication of committed.toReversed()) publication[1]()
    throw error
  }
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
  const previousRootIdentity = activeRootIdentity
  const previousErrorOwner = activeErrorOwner
  activeOwner = owner
  activeContextFrame = owner[2]
  activeRootIdentity = owner[3]
  activeErrorOwner = owner
  try {
    return operation()
  } finally {
    activeOwner = previous
    activeContextFrame = previousContext
    activeRootIdentity = previousRootIdentity
    activeErrorOwner = previousErrorOwner
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

function withRootIdentity<T>(rootIdentity: RootIdentity | null, operation: () => T): T {
  const previous = activeRootIdentity
  activeRootIdentity = rootIdentity
  try {
    return operation()
  } finally {
    activeRootIdentity = previous
  }
}

function onCleanup(cleanup: () => void): void {
  activeOwner?.[1].add(cleanup)
}

function disposeOwner(owner: Owner): void {
  if (owner[0]) return
  owner[0] = true
  if (DEV) activeOwnerCount -= 1
  pendingInsertionCommits.delete(owner)
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

/** @internal Test-only allocation and retention evidence. */
export function readCompiledOwnerMetrics(): {
  readonly active: number
  readonly created: number
} {
  return { active: activeOwnerCount, created: createdOwnerCount }
}

function mountCompiledBindingBefore(
  parent: Node,
  value: CompiledBinding<unknown>,
  before: Node | null,
): void {
  const unset = Symbol(DEV ? 'Vidact.UnsetBinding' : undefined)
  const initial = value[1]()
  const scalarInitial = isScalarRenderValue(initial)
  const hydratedTextRange = scalarInitial
    ? claimHydrationTextRange(parent, toText(initial))
    : undefined
  const borrowedHydrationRange =
    isHydrating() && !scalarInitial
      ? isStructuralBinding(initial) && initial[2] === 'slot'
        ? borrowCurrentHydrationSlot(parent)
        : borrowActiveHydrationSlot(parent)
      : undefined
  const hydratedStructuralRange =
    isHydrating() && !scalarInitial
      ? (borrowedHydrationRange ?? claimHydrationSlotRange(parent))
      : undefined
  const hydratedRange = hydratedTextRange ?? hydratedStructuralRange
  const start = hydratedRange?.[0] ?? document.createComment(DEV ? 'vidact:binding' : '')
  const end = hydratedRange?.[1] ?? document.createComment(DEV ? '/vidact:binding' : '')
  if (hydratedRange === undefined) {
    parent.insertBefore(start, before)
    parent.insertBefore(end, before)
  }
  let current: unknown = hydratedTextRange === undefined ? unset : initial
  let currentOwner: Owner | null = null
  let text: Text | null = hydratedTextRange?.[2] ?? null

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
    commitPublishedNodes(staged)
    current = next
  }

  if (hydratedStructuralRange !== undefined) {
    const nextOwner = createOwner()
    const [fragment, staged] = withHydrationInsertion(parent, end, () =>
      stageRender(() => initial as RenderValue, nextOwner),
    )
    parent.insertBefore(fragment, end)
    commitPublishedNodes(staged)
    currentOwner = nextOwner
    current = initial
  } else if (hydratedRange === undefined) {
    update()
  }
  const removeUpdater = subscribeBinding(value, update)
  onCleanup(() => {
    removeUpdater()
    clear()
    if (borrowedHydrationRange === undefined) {
      start.remove()
      end.remove()
    }
  })
}

function borrowActiveHydrationSlot(parent: Node): readonly [Comment, Comment] | undefined {
  const start = hydrationCursor(parent)?.previousSibling
  if (!(start instanceof Comment) || start.data !== 'vidact:v1:b') return undefined

  const insertion = hydrationInsertionPoint()
  if (
    insertion !== undefined &&
    insertion[0] === parent &&
    insertion[1] instanceof Comment &&
    insertion[1].data === '/vidact:v1:b'
  ) {
    return [start, insertion[1]]
  }

  const end = closingHydrationSlot(start)
  return end === undefined ? undefined : [start, end]
}

function borrowCurrentHydrationSlot(parent: Node): readonly [Comment, Comment] | undefined {
  const start = hydrationCursor(parent)
  if (!(start instanceof Comment) || start.data !== 'vidact:v1:b') return undefined
  const end = closingHydrationSlot(start)
  return end === undefined ? undefined : [start, end]
}

function closingHydrationSlot(start: Comment): Comment | undefined {
  let depth = 0
  for (let node = start.nextSibling; node !== null; node = node.nextSibling) {
    if (!(node instanceof Comment)) continue
    if (node.data === 'vidact:v1:b') {
      depth += 1
      continue
    }
    if (node.data !== '/vidact:v1:b') continue
    if (depth === 0) return node
    depth -= 1
  }
  return undefined
}

function materialize(value: RenderValue): Node[] {
  const insertionPoint = hydrationInsertionPoint()
  if (insertionPoint !== undefined) {
    const [parent, before] = insertionPoint
    const first = hydrationCursor(parent)
    if (first === undefined) throw new Error('hydration insertion point requires active hydration')
    insertValue(parent, value, before)
    const after = hydrationCursor(parent)
    const nodes: Node[] = []
    for (let node = first; node !== null && node !== after; node = node.nextSibling) {
      nodes.push(node)
    }
    return nodes
  }
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
  const insertionPoint = hydrationInsertionPoint()
  if (insertionPoint !== undefined) {
    const [parent, before] = insertionPoint
    const first = hydrationCursor(parent)
    if (first === undefined) throw new Error('hydration insertion point requires active hydration')
    withOwner(owner, () => insertValue(parent, value, before))
    const nodes: Node[] = []
    for (let node = first; node !== null && node !== before; node = node.nextSibling) {
      nodes.push(node)
    }
    return [document.createDocumentFragment(), nodes]
  }
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
  if (value === null || value === undefined || typeof value === 'boolean') {
    claimHydrationText(parent, '')
    return
  }
  if (isStructuralBinding(value)) {
    if (isHydrating() && !isCompiledComponentResult(value) && value[2] === undefined) {
      throw new HydrationMismatch('structural binding hydration markers are not available')
    }
    adoptCompiledRoot(value)
    value[1](parent, before)
    return
  }
  if (isCompiledBinding(value)) {
    mountCompiledBindingBefore(parent, value, before)
    return
  }
  if (isRenderableProtocol(value)) {
    insertValue(parent, materializeRenderable(value) as RenderValue, before, moves)
    return
  }
  if (Array.isArray(value)) {
    if (hasInvalidChild(value)) {
      throw new TypeError(
        DEV ? 'unsupported compiled child value; expected a DOM node or owned block' : 'V009',
      )
    }
    const hydratedRange = claimHydrationArrayRange(parent)
    for (const item of value) insertValue(parent, item, before, moves)
    if (hydratedRange !== undefined) finishHydrationArrayRange(parent, hydratedRange[1])
    return
  }
  if (value instanceof DocumentFragment) {
    const hydrationChildren = hydrationFragmentChildren(value)
    if (hydrationChildren !== undefined) {
      for (const child of hydrationChildren) {
        insertValue(parent, child as RenderValue, before, moves)
      }
      return
    }
    // oxlint-disable-next-line unicorn/no-useless-spread -- Snapshot the live NodeList before moving nodes.
    for (const child of [...value.childNodes]) insertValue(parent, child, before, moves)
    return
  }
  if (value instanceof Node) {
    moves?.push([value, value.parentNode, value.nextSibling])
    adoptCompiledRoot(value)
    claimPendingRefOwners(value)
    if (!claimHydrationNode(parent, value)) parent.insertBefore(value, before)
    if (!(parent instanceof DocumentFragment)) commitPendingRefs(value)
    return
  }
  if (typeof value === 'object' || typeof value === 'function' || typeof value === 'symbol') {
    throw new TypeError(
      DEV ? 'unsupported compiled child value; expected a DOM node or owned block' : 'V009',
    )
  }
  const content = String(value)
  if (claimHydrationText(parent, content) === undefined) {
    parent.insertBefore(document.createTextNode(content), before)
  }
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

function nodesBetween(start: Node, end: Node): Node[] {
  const nodes: Node[] = []
  for (let node = start.nextSibling; node !== null && node !== end; node = node.nextSibling) {
    nodes.push(node)
  }
  return nodes
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
  if (!isHydrating()) commitPublishedNodesNow([root])
}

function commitPublishedNodes(nodes: readonly Node[]): void {
  if (isHydrating()) return
  commitPublishedNodesNow(nodes)
}

function commitPublishedNodesNow(nodes: readonly Node[]): void {
  const publicationRoot = nodes[0]?.getRootNode()
  if (publicationRoot instanceof DocumentFragment && !(publicationRoot instanceof ShadowRoot)) {
    return
  }
  for (const node of nodes) commitNodeInsertions(node)
  for (const node of nodes) commitNodeRefs(node)
  for (const node of nodes) commitNodeResources(node)
}

function commitNodeInsertions(root: Node): void {
  visitNodes(root, (node) => {
    if (node instanceof Comment) commitOwnerInsertions(componentCommitOwners.get(node))
  })
}

function commitNodeRefs(root: Node): void {
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
  })
}

function commitNodeResources(root: Node): void {
  visitNodes(root, (node) => {
    if (node instanceof Comment) commitOwnerResources(componentCommitOwners.get(node))
  })
}

function commitOwnerInsertions(owner: Owner | undefined): void {
  if (owner === undefined || owner[0]) return
  const commits = pendingInsertionCommits.get(owner)
  if (commits === undefined) return
  pendingInsertionCommits.delete(owner)
  for (const commit of commits) commit()
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
  commitPublishedNodesNow(nodes)
}

function visitNodes(root: Node, visit: (node: Node) => void): void {
  visit(root)
  for (const child of root.childNodes) visitNodes(child, visit)
}

function attachRef<T>(value: RefValue<T>, target: T): () => void {
  if (value === null || value === undefined) return noop
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

function scheduleOwnerFlush(owner: Owner, flush: () => void): void {
  const connection = owner[5]
  if (connection === null || connection === undefined || connection.connected) {
    scheduleFlush(flush)
    return
  }
  if (connection.deferredFlushes.has(flush)) return
  const cancel = scheduleDeferredTask(() => {
    connection.deferredFlushes.delete(flush)
    scheduleFlush(flush)
  })
  connection.deferredFlushes.set(flush, cancel)
}

function drainFlushes(): void {
  if (drainingFlushes || transactionDepth > 0) return
  drainingFlushes = true
  const publication: PublicationOperation[] = []
  activePublication = publication
  const runs = new Map<() => void, number>()
  let committing = false
  let failure: unknown
  let failed = false
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
    failure = error
    failed = true
  } finally {
    activePublication = null
    drainingFlushes = false
  }
  if (failed) {
    const owner = failedOwner
    failedOwner = null
    if (!routeOwnerError(owner, failure)) throw failure
  }
  if (scheduledFlushes.size > 0) drainFlushes()
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
  activePublication.push([
    operation[0],
    operation[1],
    operation[2],
    operation[3],
    operation[4],
    operation[5] ?? activeErrorOwner,
  ])
}

function commitPublication(operations: readonly PublicationOperation[]): void {
  const ordered = operations.some((operation) => operation[4] !== undefined)
    ? operations.toSorted((left, right) => (left[4] ?? 0) - (right[4] ?? 0))
    : operations
  const applied: PublicationOperation[] = []
  let current: PublicationOperation | undefined
  try {
    for (const operation of ordered) {
      current = operation
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
    failedOwner = current?.[5] ?? null
    throw error
  }
  try {
    for (const operation of ordered) {
      current = operation
      operation[3]?.()
    }
  } catch (error) {
    for (let index = applied.length - 1; index >= 0; index -= 1) {
      try {
        applied[index]?.[1]()
      } catch {
        // Preserve the finalization error while attempting every inverse.
      }
    }
    failedOwner = current?.[5] ?? null
    throw error
  }
}

function runOwnerTask(owner: Owner, operation: () => void): void {
  try {
    operation()
  } catch (error) {
    if (!routeOwnerError(owner, error)) throw error
  }
}

function routeOwnerError(owner: Owner | null, failure: unknown): boolean {
  let error = failure
  let boundary = owner?.[4] ?? null
  while (boundary !== null) {
    try {
      boundary.handle(error)
      return true
    } catch (nextError) {
      error = nextError
      boundary = boundary.parent
    }
  }
  const onUncaughtError = owner?.[3].onUncaughtError
  if (onUncaughtError === undefined) return false
  onUncaughtError(error)
  return true
}

function isCompiledContext<Value>(value: unknown): value is CompiledContext<Value> {
  return typeof value === 'function' && CONTEXT in value
}

function isPromiseLike<Value>(value: unknown): value is PromiseLike<Value> {
  return (
    ((typeof value === 'object' && value !== null) || typeof value === 'function') &&
    typeof (value as PromiseLike<Value>).then === 'function'
  )
}

function isAsyncResource<Value>(value: unknown): value is AsyncResource<Value> {
  return typeof value === 'object' && value !== null && ASYNC_RESOURCE in value
}

function isSuspension(value: unknown): value is Suspension {
  return typeof value === 'object' && value !== null && SUSPENSION in value
}

function readResource<Value>(resource: AsyncResource<Value>): Value {
  const state = resource[ASYNC_RESOURCE]
  if (state.status === 'fulfilled') return state.value as Value
  if (state.status === 'rejected') throw state.reason
  throw { [SUSPENSION]: true, resource } satisfies Suspension
}

function subscribeResource(resource: AsyncResource<unknown>, listener: () => void): () => void {
  const state = resource[ASYNC_RESOURCE]
  if (state.status !== 'pending') {
    queueMicrotask(listener)
    return noop
  }
  let active = true
  state.subscribers += 1
  state.listeners.add(listener)
  return () => {
    if (!active) return
    active = false
    if (state.listeners.delete(listener)) state.subscribers -= 1
    if (state.status === 'pending' && state.subscribers === 0) state.cancel?.()
  }
}

function settleResource<Value>(
  state: AsyncResourceState<Value>,
  status: 'fulfilled' | 'rejected',
  result: Value | unknown,
): void {
  if (state.status !== 'pending') return
  state.status = status
  if (status === 'fulfilled') state.value = result as Value
  else state.reason = result
  const listeners = [...state.listeners]
  state.listeners.clear()
  state.subscribers = 0
  for (const listener of listeners) listener()
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
