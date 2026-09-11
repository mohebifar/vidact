import { COMPILED_DELEGATED_EVENT_INVOKE, retainCompiledEventRoot } from '../dom/events.ts'
import {
  currentIntrinsicNamespace,
  withIntrinsicNamespace,
  type IntrinsicNamespace,
} from '../dom/intrinsic.ts'
import {
  HydrationMismatch,
  beginHydration,
  borrowHydrationSlotRange,
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
  skipHydrationRange,
  withoutHydration,
  withHydrationComponentRange,
  withHydrationInsertion,
  withHydrationCursor,
} from '../hydration-bridge.ts'
import { createIndexedList } from '../indexed-list.ts'
import { createKeyedList } from '../keyed-list.ts'
import {
  canReconcileRenderable,
  isRenderableProtocol,
  materializeRenderable,
  materializeRenderableWithInput,
  RENDERABLE,
  renderableIdentity,
  renderablePropsSnapshot,
  type RenderableProtocol,
} from '../renderable-protocol.ts'
import { scheduleDeferredTask, scheduleTask, type CancelScheduledTask } from '../scheduler.ts'
import {
  forEachSource,
  intersectsSources,
  isEmptySources,
  unionSources,
  type SourceMask,
} from '../source-mask.ts'
import {
  createReadOnlyStateSlot,
  createStateSlot,
  replaceReadOnlyStateSlot,
  type ReadOnlyStateCell,
  type StateSlot,
} from '../state-slot.ts'
import { isSuspension, subscribeResource, useAsync } from './async-resource.ts'
import {
  BINDING,
  COMPONENT_SPREAD_SOURCE as componentSpreadSourceSymbol,
  CONTEXT,
  STRUCTURAL,
  type AsyncResource,
  type CompiledBinding,
  type CompiledComponentResult,
  type CompiledContext,
  type CompiledErrorHandler,
  type CompiledRenderValue,
  type CompiledScope,
  type ProfilerOnRender,
  type StructuralBinding,
} from './types.ts'
import { hasInvalidChild } from './validation.ts'

export const COMPONENT_SPREAD_SOURCE = componentSpreadSourceSymbol

const MAX_FLUSH_PASSES = 100
export const DEV = typeof __VIDACT_DEV__ === 'undefined' || __VIDACT_DEV__
let retainedUiEnabled = typeof __VIDACT_RETAINED_UI__ !== 'undefined' && __VIDACT_RETAINED_UI__
let profilingEnabled = false
let activeOwnerCount = 0
let createdOwnerCount = 0
let createdUpdaterCount = 0
let createdSchedulerPlanCount = 0
const noop = (): void => {}
const COMPILED_EVENT_HANDLER = Symbol('vidact.compiled-event')
const COMPILED_INLINE_EVENT_OWNER = Symbol('vidact.compiled-event.owner')
const UNSET_BINDING = Symbol(DEV ? 'Vidact.UnsetBinding' : undefined)

type CompiledEventHandler = ((...arguments_: never[]) => void) & {
  [COMPILED_EVENT_HANDLER]: true
}

type CompiledInlineEventHandler<Arguments extends unknown[]> = ((
  ...arguments_: Arguments
) => void) & {
  [COMPILED_INLINE_EVENT_OWNER]: Owner
  [COMPILED_DELEGATED_EVENT_INVOKE]: (...arguments_: Arguments) => void
}

type CompiledEventMetadata = {
  [COMPILED_EVENT_HANDLER]?: true
  [COMPILED_DELEGATED_EVENT_INVOKE]?: (...arguments_: never[]) => void
}

type ContextFrame = {
  readonly context: CompiledContext<unknown>
  readonly input: unknown
  readonly parent: ContextFrame | null
  readonly owner: Owner | null
}

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
  cleanups: Array<() => void>,
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

type RetainedResource = {
  readonly owner: Owner
  readonly connect: () => void
  readonly disconnect: () => void
  active: boolean
  connected: boolean
  disposed: boolean
  readonly phase: number
}

type FlushTask = (() => void) | { readonly [1]: (sources?: SourceMask) => void }

type RetainedConnection = {
  readonly parent: RetainedConnection | null
  readonly children: Set<RetainedConnection>
  readonly resources: Set<RetainedResource>
  readonly deferredFlushes: Map<FlushTask, CancelScheduledTask>
  readonly afterFlush: Set<() => void>
  visible: boolean
  connected: boolean
  disposed: boolean
}

type CompiledUpdater = [
  reads: SourceMask,
  writes: SourceMask | undefined,
  run: (active: SourceMask) => void,
  active: boolean,
]

type SourceOperations = readonly [
  empty: (mask: SourceMask) => boolean,
  intersects: (left: SourceMask, right: SourceMask) => boolean,
  union: (left: SourceMask, right: SourceMask) => SourceMask,
  visit: (mask: SourceMask, visitor: (index: number) => void) => void,
]

const wideSourceOperations: SourceOperations = [
  isEmptySources,
  intersectsSources,
  unionSources,
  forEachSource,
]
const narrowSourceOperations: SourceOperations = [
  (mask) => mask === 0,
  (left, right) => ((left as number) & (right as number)) !== 0,
  (left, right) => ((left as number) | (right as number)) >>> 0,
  (mask, visitor) => forEachSource(mask, visitor),
]

type RenderValue = CompiledRenderValue

export function deferred(render: () => CompiledRenderValue): StructuralBinding {
  return [
    STRUCTURAL,
    (parent, before) => {
      const value = render()
      if (ownedStructuralBinding(value)?.[2] === 'slot') {
        insertValue(parent, value, before)
        return
      }
      const hydrated = borrowHydrationSlotRange(parent, true)
      if (hydrated === undefined) {
        insertValue(parent, value, before)
        return
      }
      claimHydrationSlotRange(parent)
      insertValue(parent, value, hydrated[1])
    },
    'slot',
  ]
}

/** @internal */
export function retainedActivity(
  modeInput: 'visible' | 'hidden' | CompiledBinding<'visible' | 'hidden'>,
  render: () => CompiledRenderValue,
): StructuralBinding {
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
    owner[1].push(remove)
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
      // Server content is on screen but the client suspended while hydrating it (a lazy
      // chunk still loading, say). The server nodes are kept until the next publish,
      // which renders client-side and replaces them — the same shape as a claimed
      // pending fallback, without ever showing the fallback over content the visitor
      // can already see.
      let dehydrated = false

      const publish = (
        read: () => CompiledRenderValue,
        kind: 'content' | 'fallback',
        replaceServerNodes = false,
      ): void => {
        const currentParent = rangeParent(start, end, 'Suspense boundary')
        const nextOwner = createOwner(
          context,
          rootIdentity,
          kind === 'content' ? boundary : parentErrorBoundary,
        )
        const serverNodes = replaceServerNodes ? nodesBetween(start, end) : []
        const [fragment, nodes] = replaceServerNodes
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
        if (
          currentKind === null &&
          hydratedRange !== undefined &&
          pendingMarker === undefined &&
          isHydrating()
        ) {
          dehydrated = true
          skipHydrationRange(start, end)
          return
        }
        if (currentKind !== 'fallback') {
          try {
            publish(fallback, 'fallback', dehydrated)
            dehydrated = false
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
          publish(render, 'content', (initial && pendingMarker !== undefined) || dehydrated)
          dehydrated = false
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

type PortalRenderableProps = {
  readonly children: CompiledRenderValue | readonly CompiledRenderValue[]
}

const keyedPortalIdentities = new WeakMap<ParentNode, Map<string | number | bigint, object>>()

export function createPortal(
  children: CompiledRenderValue | readonly CompiledRenderValue[],
  container: ParentNode,
  key?: string | number | bigint | null,
): CompiledRenderValue {
  if (!(container instanceof Node) || typeof container.insertBefore !== 'function') {
    throw new TypeError(DEV ? 'createPortal requires a DOM container' : 'V026')
  }
  const input: PortalRenderableProps = { children }
  const capability = { props: input } as RenderableProtocol & {
    readonly props: PortalRenderableProps
  }
  Object.defineProperty(capability, RENDERABLE, {
    configurable: false,
    enumerable: false,
    value: {
      identity: portalIdentity(container, key),
      input,
      reconcile: true,
      construct: (currentInput: PortalRenderableProps | CompiledBinding<PortalRenderableProps>) =>
        createPortalStructural(portalChildren(currentInput), container),
    },
  })
  return capability as unknown as CompiledRenderValue
}

function portalIdentity(
  container: ParentNode,
  key: string | number | bigint | null | undefined,
): object {
  if (key == null) return container
  let identities = keyedPortalIdentities.get(container)
  if (identities === undefined) {
    identities = new Map()
    keyedPortalIdentities.set(container, identities)
  }
  let identity = identities.get(key)
  if (identity === undefined) {
    identity = {}
    identities.set(key, identity)
  }
  return identity
}

function portalChildren(
  input: PortalRenderableProps | CompiledBinding<PortalRenderableProps>,
): CompiledRenderValue | readonly CompiledRenderValue[] {
  if (!isCompiledBinding(input)) return input.children
  return binding(
    input[2],
    input[3],
    () => input[1]().children,
    input[4],
    input[5],
  ) as CompiledBinding<CompiledRenderValue>
}

function createPortalStructural(
  children: CompiledRenderValue | readonly CompiledRenderValue[],
  container: ParentNode,
): StructuralBinding {
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
      let releaseEventRoot: (() => void) | undefined
      try {
        withOwner(portalOwner, () => insertValue(fragment, children, end))
      } catch (error) {
        disposeOwner(portalOwner)
        logicalMarker.remove()
        throw error
      }
      const rollback = (): void => {
        releaseEventRoot?.()
        releaseEventRoot = undefined
        removeBetween(start, end)
        start.remove()
        end.remove()
      }
      const publication: PortalPublication = [
        () => {
          releaseEventRoot = retainCompiledEventRoot(container)
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
let disposalCascadeDepth = 0
let drainingFlushes = false
let activePublication: PublicationOperation[] | null = null
const scheduledFlushes = new Set<FlushTask>()
const disposalCascadeOwners = new Set<Owner>()
const scopeOwners = new WeakMap<CompiledScope, Owner>()
const scopeNamespaces = new WeakMap<CompiledScope, IntrinsicNamespace>()
const componentRanges = new WeakMap<CompiledComponentResult, ComponentRange>()
const pendingRefs = new WeakMap<Element, PendingRef>()
const componentCommitOwners = new WeakMap<Comment, Owner>()
const pendingInsertionCommits = new WeakMap<Owner, Set<() => void>>()
const pendingOwnerCommits = new WeakMap<Owner, Set<() => void>>()
const pendingRootPortals = new WeakMap<RootIdentity, Set<PortalPublication>>()
let pendingRefCount = 0
let pendingInsertionOwnerCount = 0
let pendingOwnerCommitCount = 0
let visitedPublishedNodeCount = 0

function setPendingRef(element: Element, pending: PendingRef): void {
  if (!pendingRefs.has(element)) pendingRefCount += 1
  pendingRefs.set(element, pending)
}

function deletePendingRef(element: Element, expected?: PendingRef): boolean {
  if (expected !== undefined && pendingRefs.get(element) !== expected) return false
  if (!pendingRefs.delete(element)) return false
  pendingRefCount -= 1
  return true
}

export function createCompiledScope(): CompiledScope {
  return createScope(wideSourceOperations)
}

export function createNarrowCompiledScope(): CompiledScope {
  return createScope(narrowSourceOperations)
}

type CompilerKeyedUpdater = [
  reads: SourceMask,
  writes: SourceMask | undefined,
  run: (active: SourceMask) => void,
  active: boolean,
  errorOwner: Owner,
  context: ContextFrame | null,
]

/** Compiler-emitted map callbacks only need a compact, narrow row scheduler. */
class CompilerKeyedScope {
  readonly owner = createOwner()
  readonly updaters: Array<CompilerKeyedUpdater | undefined> = []
  pending: SourceMask = 0
  batchDepth = 0
  flushing = false
  hasWriter = false
  cachedUpdaterOrder: number[] | undefined;

  [1](sources?: SourceMask): void {
    if (this.owner[0]) return
    if (sources === undefined) {
      this.flush()
      return
    }
    if (narrowSourceOperations[0](sources)) return
    const wasIdle = narrowSourceOperations[0](this.pending)
    this.pending = narrowSourceOperations[2](this.pending, sources)
    if (wasIdle && this.batchDepth === 0) this.schedule()
  }

  [3](): void {
    if (this.owner[0]) return
    try {
      disposeOwner(this.owner)
    } finally {
      this.pending = 0
      for (const updater of this.updaters) {
        if (updater !== undefined) updater[3] = false
      }
      this.updaters.length = 0
      this.cachedUpdaterOrder = undefined
    }
  }

  constructor() {
    const scope = this as unknown as CompiledScope
    scopeOwners.set(scope, this.owner)
    scopeNamespaces.set(scope, currentIntrinsicNamespace())
    activeScopeCollector?.add(scope)
    if (activeScopeCollector !== null) activeConstructionOwner = this.owner
  }

  [0](reads: SourceMask, run: (active: SourceMask) => void, writes?: SourceMask): () => void {
    if (this.owner[0]) {
      throw new Error(DEV ? 'cannot add an updater to a disposed scope' : 'V002')
    }
    const errorOwner = activeOwner ?? this.owner
    const entry: CompilerKeyedUpdater = [
      reads,
      writes,
      run,
      true,
      errorOwner,
      activeContextFrame ?? errorOwner[2],
    ]
    if (DEV) createdUpdaterCount += 1
    const index = this.updaters.length
    this.updaters.push(entry)
    this.hasWriter ||= writes !== undefined
    this.cachedUpdaterOrder = undefined
    if (activeOwner === this.owner) return noop
    const remove = (): void => {
      if (this.updaters[index] !== entry) return
      entry[3] = false
      this.updaters[index] = undefined
      this.cachedUpdaterOrder = undefined
    }
    activeOwner?.[1].push(remove)
    return remove
  }

  [2]<T>(operation: () => T): T {
    this.batchDepth += 1
    transactionDepth += 1
    try {
      return operation()
    } finally {
      this.batchDepth -= 1
      if (this.batchDepth === 0 && !narrowSourceOperations[0](this.pending)) this.schedule()
      transactionDepth -= 1
      if (transactionDepth === 0) drainFlushes()
    }
  }

  private schedule(): void {
    if (retainedUiEnabled) scheduleOwnerFlush(this.owner, this)
    else scheduleFlush(this)
  }

  private flush(): void {
    if (this.flushing || narrowSourceOperations[0](this.pending)) return
    const operation = (): void => {
      this.flushing = true
      try {
        let pass = 0
        while (!narrowSourceOperations[0](this.pending)) {
          pass += 1
          if (pass > MAX_FLUSH_PASSES) {
            this.pending = 0
            throw new Error(DEV ? 'Vidact compiled scope did not stabilize' : 'V001')
          }
          let active = this.pending
          this.pending = 0
          const order = this.hasWriter
            ? (this.cachedUpdaterOrder ??= topologicalUpdaterOrder(
                this.updaters as ReadonlyArray<CompiledUpdater | undefined>,
                narrowSourceOperations,
              ))
            : undefined
          const count = order?.length ?? this.updaters.length
          for (let position = 0; position < count; position += 1) {
            const index = order?.[position] ?? position
            const updater = this.updaters[index]
            if (
              updater === undefined ||
              !updater[3] ||
              !narrowSourceOperations[1](active, updater[0])
            ) {
              continue
            }
            try {
              const invoke = () =>
                withOwner(updater[4], () =>
                  withContextFrame(updater[5], () =>
                    withScopeNamespace(this as unknown as CompiledScope, () => updater[2](active)),
                  ),
                )
              if (profilingEnabled) measureProfileWork(this.owner, 'updater', invoke)
              else invoke()
            } catch (error) {
              if (!routeOwnerError(updater[4], error)) {
                failedOwner = updater[4]
                throw error
              }
            }
            if (updater[1] !== undefined) {
              active = narrowSourceOperations[2](active, updater[1])
            }
          }
        }
      } finally {
        this.flushing = false
      }
      if (retainedUiEnabled) notifyRetainedFlush(this.owner[5] ?? null)
    }
    if (profilingEnabled) measureProfileWork(this.owner, 'scheduler', operation, true)
    else operation()
  }
}

function createCompilerKeyedScope(): CompiledScope {
  return new CompilerKeyedScope() as unknown as CompiledScope
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
  let freeUpdaterIndexes: number[] | undefined
  let addedDuringFlush: Set<CompiledUpdater> | undefined
  let batchDepth = 0
  let flushing = false
  let pending: SourceMask = 0
  let cachedUpdaterOrder: number[] | undefined
  let hasWriter = false

  const flush = (): void => {
    if (owner[0] || flushing) return
    const operation = (): void => {
      flushing = true
      try {
        let pass = 0
        const updaterOrder = hasWriter
          ? (cachedUpdaterOrder ??= topologicalUpdaterOrder(updaters, operations))
          : undefined
        while (!operations[0](pending)) {
          pass += 1
          if (pass > MAX_FLUSH_PASSES) {
            pending = 0
            throw new Error(DEV ? 'Vidact compiled scope did not stabilize' : 'V001')
          }

          let active = pending
          pending = 0
          const updaterCount = updaterOrder?.length ?? updaters.length
          for (let position = 0; position < updaterCount; position += 1) {
            const index = updaterOrder?.[position] ?? position
            const updater = updaters[index]
            if (
              updater === undefined ||
              addedDuringFlush?.has(updater) ||
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
          addedDuringFlush?.clear()
        }
      } finally {
        addedDuringFlush?.clear()
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
      if (DEV) createdUpdaterCount += 1
      const reusableIndex = freeUpdaterIndexes?.pop()
      const index = reusableIndex ?? updaters.length
      updaters[index] = entry
      hasWriter ||= writes !== undefined
      cachedUpdaterOrder = undefined
      if (flushing) (addedDuringFlush ??= new Set()).add(entry)
      const remove = (): void => {
        if (updaters[index] !== entry) return
        entry[3] = false
        updaters[index] = undefined
        cachedUpdaterOrder = undefined
        ;(freeUpdaterIndexes ??= []).push(index)
      }
      if (activeOwner !== null && activeOwner !== owner) activeOwner[1].push(remove)
      return remove
    },
    (sources) => {
      if (owner[0] || operations[0](sources)) return
      const wasIdle = operations[0](pending)
      pending = operations[2](pending, sources)
      if (wasIdle && batchDepth === 0) {
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
        hasWriter = false
        if (freeUpdaterIndexes !== undefined) freeUpdaterIndexes.length = 0
        addedDuringFlush?.clear()
      }
    },
  ]
  scopeOwners.set(scope, owner)
  scopeNamespaces.set(scope, namespace)
  activeScopeCollector?.add(scope)
  if (activeScopeCollector !== null) activeConstructionOwner = owner
  return scope
}

function topologicalUpdaterOrder(
  updaters: ReadonlyArray<CompiledUpdater | undefined>,
  operations: SourceOperations,
): number[] {
  if (DEV) createdSchedulerPlanCount += 1
  const activeIndexes: number[] = []
  let hasWriter = false
  for (let index = 0; index < updaters.length; index += 1) {
    const updater = updaters[index]
    if (updater === undefined || !updater[3]) continue
    activeIndexes.push(index)
    if (updater[1] !== undefined) hasWriter = true
  }
  if (!hasWriter) return activeIndexes
  const readersBySource = new Map<number, number[]>()
  for (const readerIndex of activeIndexes) {
    operations[3](updaters[readerIndex]![0], (sourceIndex) => {
      const readers = readersBySource.get(sourceIndex)
      if (readers === undefined) readersBySource.set(sourceIndex, [readerIndex])
      else readers.push(readerIndex)
    })
  }
  const edges = new Map<number, number[]>()
  for (const writerIndex of activeIndexes) {
    const writes = updaters[writerIndex]![1]
    if (writes === undefined) continue
    const readers = new Set<number>()
    operations[3](writes, (sourceIndex) => {
      for (const readerIndex of readersBySource.get(sourceIndex) ?? []) {
        if (writerIndex !== readerIndex) readers.add(readerIndex)
      }
    })
    if (readers.size > 0) {
      edges.set(
        writerIndex,
        [...readers].toSorted((left, right) => left - right),
      )
    }
  }

  const visitIndexes = new Int32Array(updaters.length).fill(-1)
  const lowLinks = new Int32Array(updaters.length)
  const stack: number[] = []
  const onStack = new Uint8Array(updaters.length)
  const components: number[][] = []
  let nextVisitIndex = 0

  const connect = (updaterIndex: number): void => {
    const visitIndex = nextVisitIndex++
    visitIndexes[updaterIndex] = visitIndex
    lowLinks[updaterIndex] = visitIndex
    stack.push(updaterIndex)
    onStack[updaterIndex] = 1

    for (const readerIndex of edges.get(updaterIndex) ?? []) {
      if (visitIndexes[readerIndex] === -1) {
        connect(readerIndex)
        lowLinks[updaterIndex] = Math.min(lowLinks[updaterIndex]!, lowLinks[readerIndex]!)
      } else if (onStack[readerIndex] === 1) {
        lowLinks[updaterIndex] = Math.min(lowLinks[updaterIndex]!, visitIndexes[readerIndex]!)
      }
    }

    if (lowLinks[updaterIndex] !== visitIndexes[updaterIndex]) return
    const component: number[] = []
    let member: number
    do {
      member = stack.pop()!
      onStack[member] = 0
      component.push(member)
    } while (member !== updaterIndex)
    component.sort((left, right) => left - right)
    components.push(component)
  }

  for (const updaterIndex of activeIndexes) {
    if (visitIndexes[updaterIndex] === -1) connect(updaterIndex)
  }

  const componentByUpdater = new Int32Array(updaters.length).fill(-1)
  const componentEdges = components.map(() => new Set<number>())
  const componentIndegrees = new Uint32Array(components.length)
  const componentFirstIndexes = components.map((component) => component[0]!)
  for (let componentIndex = 0; componentIndex < components.length; componentIndex += 1) {
    for (const updaterIndex of components[componentIndex]!) {
      componentByUpdater[updaterIndex] = componentIndex
    }
  }
  for (const [writerIndex, readers] of edges) {
    const writerComponent = componentByUpdater[writerIndex]!
    for (const readerIndex of readers) {
      const readerComponent = componentByUpdater[readerIndex]!
      if (
        writerComponent === readerComponent ||
        componentEdges[writerComponent]!.has(readerComponent)
      ) {
        continue
      }
      componentEdges[writerComponent]!.add(readerComponent)
      componentIndegrees[readerComponent] = componentIndegrees[readerComponent]! + 1
    }
  }

  const ready = components
    .map((_, index) => index)
    .filter((index) => componentIndegrees[index] === 0)
    .sort((left, right) => componentFirstIndexes[left]! - componentFirstIndexes[right]!)
  const ordered: number[] = []
  while (ready.length > 0) {
    const componentIndex = ready.shift()!
    ordered.push(...components[componentIndex]!)
    for (const readerComponent of componentEdges[componentIndex]!) {
      componentIndegrees[readerComponent] = componentIndegrees[readerComponent]! - 1
      if (componentIndegrees[readerComponent] === 0) {
        ready.push(readerComponent)
        ready.sort((left, right) => componentFirstIndexes[left]! - componentFirstIndexes[right]!)
      }
    }
  }
  return ordered
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
  owner[1].push(removeUpdater)
  return slot
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
  if (!(CONTEXT in context)) {
    throw new Error(DEV ? 'runWithCompiledContext received an unknown context' : 'V003')
  }
  const parent = activeContextFrame ?? activeOwner?.[2] ?? null
  return withContextFrame(
    {
      context: context as CompiledContext<unknown>,
      input: value,
      parent,
      owner: activeOwner,
    },
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
  storeSubscribe:
    | ((onStoreChange: () => void) => () => void)
    | CompiledBinding<readonly [(onStoreChange: () => void) => () => void, () => T, (() => T)?]>,
  getSnapshot?: () => T,
  _getServerSnapshot?: () => T,
): StateSlot<T> {
  const owner = scopeOwners.get(scope)
  if (owner === undefined) {
    throw new Error(DEV ? 'createCompiledExternalStore received an unknown scope' : 'V003')
  }
  const reactiveStore = isCompiledBinding(storeSubscribe) ? storeSubscribe : undefined
  let currentSubscribe: (onStoreChange: () => void) => () => void
  let currentGetSnapshot!: () => T
  const readStore = (): void => {
    const store = reactiveStore?.[1]()
    currentSubscribe = store?.[0] ?? (storeSubscribe as (onStoreChange: () => void) => () => void)
    currentGetSnapshot = store?.[1] ?? (getSnapshot as () => T)
    if (typeof currentSubscribe !== 'function' || typeof currentGetSnapshot !== 'function') {
      throw new TypeError(
        DEV ? 'external store requires subscribe and getSnapshot functions' : 'V020',
      )
    }
  }
  readStore()
  const slot = createStateSlot(scope[1], sourceMask, currentGetSnapshot(), stateWriteGuard(scope))
  let active = false
  let unsubscribe = noop
  const checkSnapshot = (): void => {
    if (!active) return
    const nextSnapshot = currentGetSnapshot()
    scope[2](() => slot.replace(nextSnapshot))
  }
  const activateStore = (): void => {
    readStore()
    active = true
    try {
      const remove = currentSubscribe(() => runOwnerTask(owner, checkSnapshot))
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
  }
  const deactivateStore = (): void => {
    active = false
    unsubscribe()
    unsubscribe = noop
  }
  const reconnect = (): void => {
    if (!active) {
      readStore()
      return
    }
    deactivateStore()
    activateStore()
  }
  const removeStoreUpdater =
    reactiveStore === undefined ? noop : subscribeBinding(reactiveStore, reconnect)

  if (!retainedUiEnabled) {
    try {
      activateStore()
    } catch (error) {
      removeStoreUpdater()
      throw error
    }
    owner[1].push(() => {
      removeStoreUpdater()
      deactivateStore()
    })
    return slot
  }
  const [activateResource, disposeResource] = createRetainedResource(
    owner,
    activateStore,
    deactivateStore,
    0,
  )
  try {
    activateResource()
  } catch (error) {
    disposeResource()
    throw error
  }
  owner[1].push(() => {
    removeStoreUpdater()
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

const ownedBlockFacades = new WeakMap<StructuralBinding, RenderableProtocol>()
const ownedFacadeBlocks = new WeakMap<RenderableProtocol, StructuralBinding>()

function ownedStructuralBinding(value: unknown): StructuralBinding | undefined {
  if (isStructuralBinding(value)) return value
  return isRenderableProtocol(value) ? ownedFacadeBlocks.get(value) : undefined
}

/**
 * Owned blocks are arrays internally, which user-level data flow must never
 * observe: dependency code inspects children with `Array.isArray` and spreads
 * them. Prop reads wrap a block in a stable renderable facade that
 * materializes back to the block when rendered.
 */
function sanitizeCompiledPropValue<T>(value: T): T {
  if (!isStructuralBinding(value)) return value
  let facade = ownedBlockFacades.get(value)
  if (facade === undefined) {
    const capability = { props: {} } as unknown as RenderableProtocol
    Object.defineProperty(capability, RENDERABLE, {
      configurable: false,
      enumerable: false,
      value: {
        identity: value,
        input: {},
        reconcile: false,
        construct: () => value,
      },
    })
    facade = capability
    ownedBlockFacades.set(value, facade)
    ownedFacadeBlocks.set(facade, value)
  }
  return facade as T
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
    return sanitizeCompiledPropValue(
      value === undefined && fallback !== undefined ? fallback() : value,
    )
  }
  const slot = createStateSlot<T>(scope[1], sourceMask, read(), assertWritable)
  if (upstream !== undefined) {
    const remove = subscribeBinding(upstream, () => slot.replace(read()))
    const owner = scopeOwners.get(scope)
    if (owner === undefined) {
      throw new Error(DEV ? 'createCompiledProp received an unknown scope' : 'V003')
    }
    owner[1].push(remove)
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
      entries().map(([name, value]) => [
        name,
        sanitizeCompiledPropValue(isCompiledBinding(value) ? value[1]() : value),
      ]),
    )
  const slot = createStateSlot(scope[1], sourceMask, read(), stateWriteGuard(scope))
  const publish = (): void => {
    const previous = slot.get()
    const next = read()
    const names = Object.keys(next)
    if (
      names.length === Object.keys(previous).length &&
      names.every((name) => Object.hasOwn(previous, name) && Object.is(previous[name], next[name]))
    ) {
      return
    }
    slot.replace(next)
  }
  const componentSpreadSource = (input as Record<PropertyKey, unknown>)[COMPONENT_SPREAD_SOURCE]
  const upstreams = new Set(
    entries()
      .map(([, value]) => value)
      .filter(isCompiledBinding),
  )
  if (isCompiledBinding(componentSpreadSource)) upstreams.add(componentSpreadSource)
  const removers = [...upstreams].map((upstream) => subscribeBinding(upstream, publish))
  const owner = scopeOwners.get(scope)
  if (owner === undefined) {
    throw new Error(DEV ? 'createCompiledRestProp received an unknown scope' : 'V003')
  }
  owner[1].push(() => {
    for (const remove of removers) remove()
  })
  return slot
}

/** @internal */
export function objectRest(
  input: Record<PropertyKey, unknown>,
  excludedNames: readonly PropertyKey[],
): Record<PropertyKey, unknown> {
  const excluded = new Set(excludedNames)
  const output: Record<PropertyKey, unknown> = {}
  for (const key of Reflect.ownKeys(input)) {
    if (excluded.has(key) || !Object.getOwnPropertyDescriptor(input, key)?.enumerable) continue
    Object.defineProperty(output, key, {
      configurable: true,
      enumerable: true,
      value: input[key],
      writable: true,
    })
  }
  return output
}

function stateWriteGuard(scope: CompiledScope): () => void {
  const owner = scopeOwners.get(scope)
  if (owner === undefined) {
    throw new Error(DEV ? 'compiled state received an unknown scope' : 'V003')
  }
  return () => {
    if (owner[0] && !disposalCascadeOwners.has(owner)) {
      throw new Error(DEV ? 'cannot update state after disposal' : 'V012')
    }
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
  handler:
    | ((...arguments_: Arguments) => void)
    | CompiledBinding<((...arguments_: Arguments) => void) | null | undefined>
    | null
    | undefined,
): (...arguments_: Arguments) => void {
  const owner = scopeOwners.get(scope)
  if (owner === undefined) {
    throw new Error(DEV ? 'compiledEvent received an unknown scope' : 'V003')
  }
  const errorOwner = activeOwner ?? owner
  const listener = (...arguments_: Arguments) => {
    if (errorOwner[0]) return
    return runOwnerTask(errorOwner, () =>
      withOwner(errorOwner, () =>
        scope[2](() => {
          const current = isCompiledBinding(handler) ? handler[1]() : handler
          if (typeof current !== 'function') return
          return current(...arguments_)
        }),
      ),
    )
  }
  ;(listener as unknown as CompiledEventHandler)[COMPILED_EVENT_HANDLER] = true
  return listener
}

export function compiledInlineEvent<Arguments extends unknown[]>(
  scope: CompiledScope,
  handler: (...arguments_: Arguments) => void,
): (...arguments_: Arguments) => void {
  const owner = scopeOwners.get(scope)
  if (owner === undefined) {
    throw new Error(DEV ? 'compiledInlineEvent received an unknown scope' : 'V003')
  }
  const listener = handler as unknown as CompiledInlineEventHandler<Arguments>
  listener[COMPILED_INLINE_EVENT_OWNER] = activeOwner ?? owner
  listener[COMPILED_DELEGATED_EVENT_INVOKE] = invokeCompiledInlineEvent
  return listener
}

function invokeCompiledInlineEvent<Arguments extends unknown[]>(
  this: CompiledInlineEventHandler<Arguments>,
  ...arguments_: Arguments
): void {
  const owner = this[COMPILED_INLINE_EVENT_OWNER]
  if (owner[0]) return
  return runOwnerTask(owner, () =>
    withOwner(owner, () => runCompiledTransaction(() => this(...arguments_))),
  )
}

export function isCompiledEventHandler(value: unknown): value is EventListener {
  if (typeof value !== 'function') return false
  const handler = value as typeof value & CompiledEventMetadata
  return (
    handler[COMPILED_EVENT_HANDLER] === true ||
    typeof handler[COMPILED_DELEGATED_EVENT_INVOKE] === 'function'
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
      const range = structuralRange(parent, before, 'choice', true, true)
      const markerlessHydration = range === undefined
      const start = range?.[0] ?? document.createComment(DEV ? 'vidact:choice' : '')
      const end = range?.[1] ?? document.createComment(DEV ? '/vidact:choice' : '')
      const hydrated = range?.[2] ?? true
      const ownsMarkers = range?.[3] ?? true
      let selected = -1
      let branchOwner: Owner | null = null
      let branchNodes: readonly Node[] = []

      const update = (): void => {
        const value = select()
        const next =
          mode === 'not-nullish' ? (value === null || value === undefined ? 1 : 0) : value ? 0 : 1
        if (next === selected) return
        const nextOwner = createOwner()
        const render = next === 0 ? consequent : alternate
        let nodes: readonly Node[]
        if (markerlessHydration && selected === -1) {
          const [first, after, hydratedNodes] = stageMarkerlessHydrationRender(
            parent,
            before,
            render,
            nextOwner,
          )
          parent.insertBefore(start, first)
          parent.insertBefore(end, after)
          nodes = hydratedNodes
        } else {
          const currentParent = rangeParent(start, end, 'choice block')
          const [fragment, stagedNodes] =
            hydrated && selected === -1
              ? withHydrationInsertion(currentParent, end, () => stageRender(render, nextOwner))
              : stageRender(render, nextOwner)
          currentParent.insertBefore(fragment, end)
          nodes = stagedNodes
        }
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
          if (ownsMarkers) {
            start.remove()
            end.remove()
          }
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
  trackIndexOrAdditionalScope?: boolean | CompiledScope,
  additionalScopeOrReads?: CompiledScope | SourceMask,
  additionalReads?: SourceMask,
): StructuralBinding {
  const compilerManaged = typeof trackIndexOrAdditionalScope === 'boolean'
  const trackIndex =
    typeof trackIndexOrAdditionalScope === 'boolean' ? trackIndexOrAdditionalScope : true
  const additionalScope =
    typeof trackIndexOrAdditionalScope === 'boolean'
      ? (additionalScopeOrReads as CompiledScope | undefined)
      : trackIndexOrAdditionalScope
  const resolvedAdditionalReads =
    typeof trackIndexOrAdditionalScope === 'boolean'
      ? additionalReads
      : (additionalScopeOrReads as SourceMask | undefined)
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
            const itemScope = compilerManaged
              ? createCompilerKeyedScope()
              : createNarrowCompiledScope()
            const owner = scopeOwners.get(itemScope)!
            const valueSlot = compilerManaged
              ? createReadOnlyStateSlot(itemScope, itemSource, value)
              : createCompiledState(itemScope, itemSource, value)
            const indexSlot = trackIndex
              ? compilerManaged
                ? createReadOnlyStateSlot(itemScope, indexSource, index)
                : createCompiledState(itemScope, indexSource, index)
              : undefined
            try {
              const nodes = withOwner(owner, () => {
                const rendered = render(
                  valueSlot as StateSlot<T>,
                  indexSlot as StateSlot<number>,
                  itemScope,
                )
                return !isHydrating() &&
                  rendered instanceof Node &&
                  !(rendered instanceof DocumentFragment)
                  ? [rendered]
                  : materialize(rendered)
              })
              return [
                nodes,
                (nextValue: T, nextIndex: number) => {
                  if (
                    Object.is(valueSlot.get(), nextValue) &&
                    (!trackIndex || indexSlot!.get() === nextIndex)
                  ) {
                    return
                  }
                  itemScope[2](() => {
                    if (compilerManaged) {
                      replaceReadOnlyStateSlot(valueSlot as ReadOnlyStateCell<T>, nextValue)
                      if (indexSlot !== undefined) {
                        replaceReadOnlyStateSlot(indexSlot as ReadOnlyStateCell<number>, nextIndex)
                      }
                    } else {
                      ;(valueSlot as StateSlot<T>).set(nextValue)
                      ;(indexSlot as StateSlot<number> | undefined)?.set(nextIndex)
                    }
                  })
                },
                itemScope,
              ] as const
            } catch (error) {
              itemScope[3]()
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
      const removeUpdater = subscribe(
        scope,
        reads,
        update,
        additionalScope,
        resolvedAdditionalReads,
      )
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
  owner[1].push(() => {
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
    activeOwner[1].push(range[2][3])
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
  const pending: PendingRef = [activeOwner, value]
  setPendingRef(element, pending)
  activeOwner?.[1].push(() => deletePendingRef(element, pending))
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
  queueOwnerCommit(owner, () => owner[1].push(attachRef(ref, create())))
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
    lifetimeOwner[1].push(() => cleanup())
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
  lifetimeOwner[1].push(disposeResource)
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
    lifetimeOwner[1].push(() => {
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
  lifetimeOwner[1].push(disposeResource)
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
    lifetimeOwner[1].push(() => {
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
  lifetimeOwner[1].push(() => {
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
    lifetimeOwner[1].push(() => {
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
  lifetimeOwner[1].push(() => {
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
  owner[1].push(() => {
    removeUpdater()
    cleanup()
  })
}

function queueOwnerCommit(owner: Owner, commit: () => void): void {
  let commits = pendingOwnerCommits.get(owner)
  if (commits === undefined) {
    commits = new Set()
    pendingOwnerCommits.set(owner, commits)
    pendingOwnerCommitCount += 1
  }
  commits.add(commit)
}

function queueInsertionCommit(owner: Owner, commit: () => void): void {
  let commits = pendingInsertionCommits.get(owner)
  if (commits === undefined) {
    commits = new Set()
    pendingInsertionCommits.set(owner, commits)
    pendingInsertionOwnerCount += 1
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
  setPendingRef(element, pending)

  const removeUpdater = subscribeBinding(value, () => {
    const next = value[1]()
    if (Object.is(next, current)) return
    if (!isRefValue(next)) {
      throw new TypeError(DEV ? 'ref must be null, a callback, or an object with current' : 'V006')
    }
    const previous = current
    const previousCleanup = cleanup
    let nextCleanup: (() => void) | undefined
    let previousDetached = false
    let committed = false
    stagePublication([
      () => {
        try {
          previousCleanup()
          previousDetached = true
        } catch (error) {
          try {
            cleanup = attachRef(previous, element)
          } catch {
            // Preserve the previous-ref cleanup error.
          }
          throw error
        }
        try {
          nextCleanup = attachRef(next, element)
        } catch (error) {
          try {
            cleanup = attachRef(previous, element)
            previousDetached = false
          } catch {
            // Preserve the next-ref attachment error.
          }
          throw error
        }
        cleanup = nextCleanup
        current = next
        committed = true
      },
      () => {
        if (!committed) {
          nextCleanup?.()
          if (previousDetached) {
            cleanup = attachRef(previous, element)
            previousDetached = false
          }
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
    deletePendingRef(element, pending)
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
  const releaseEventRoot = retainCompiledEventRoot(host)
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
    releaseEventRoot()
    try {
      range[2][3]()
    } catch {
      // Preserve the mount error while still running every component cleanup.
    }
    if (isHydrationMismatch(error) || rootIdentity.onUncaughtError === undefined) throw error
    rootIdentity.onUncaughtError(error)
    return { dispose: noop }
  }
  let disposed = false
  return {
    dispose: () => {
      if (disposed) return
      disposed = true
      try {
        range[2][3]()
      } finally {
        releaseEventRoot()
      }
    },
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

type CompiledPropApply<T> =
  | ((next: T) => void | (() => void))
  | ((element: Element, name: string, next: T) => void | (() => void))

function applyCompiledPropValue<T>(
  apply: CompiledPropApply<T>,
  element: Element | undefined,
  name: string | undefined,
  next: T,
): void | (() => void) {
  return element === undefined
    ? (apply as (next: T) => void | (() => void))(next)
    : (apply as (element: Element, name: string, next: T) => void | (() => void))(
        element,
        name!,
        next,
      )
}

export function mountCompiledProp<T>(
  value: CompiledBinding<T>,
  apply: (next: T) => void | (() => void),
): void
export function mountCompiledProp<T>(
  value: CompiledBinding<T>,
  apply: (element: Element, name: string, next: T) => void | (() => void),
  element: Element,
  name: string,
): void
export function mountCompiledProp<T>(
  value: CompiledBinding<T>,
  apply: CompiledPropApply<T>,
  element?: Element,
  name?: string,
): void {
  let current = value[1]()
  let cleanup = applyCompiledPropValue(apply, element, name, current)
  const removeUpdater = subscribeBinding(value, () => {
    const next = value[1]()
    if (Object.is(next, current)) return
    const previous = current
    let nextCleanup: void | (() => void)
    let committedNext = false
    stagePublication([
      () => {
        try {
          nextCleanup = applyCompiledPropValue(apply, element, name, next)
        } catch (error) {
          try {
            applyCompiledPropValue(apply, element, name, previous)
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
        cleanup = applyCompiledPropValue(apply, element, name, previous)
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
  // Only lists carry an array marker; a slot-kind structural must not bias the claim.
  if (hydrationKind === 'array') noteHydrationStructuralParent()
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
  borrowOuter?: boolean,
  allowMarkerlessHydration?: false,
): readonly [start: Comment, end: Comment, hydrated: boolean, ownsMarkers: boolean]
function structuralRange(
  parent: Node,
  before: Node | null,
  label: string,
  borrowOuter: boolean,
  allowMarkerlessHydration: true,
): readonly [start: Comment, end: Comment, hydrated: boolean, ownsMarkers: boolean] | undefined
function structuralRange(
  parent: Node,
  before: Node | null,
  label: string,
  borrowOuter = false,
  allowMarkerlessHydration = false,
): readonly [start: Comment, end: Comment, hydrated: boolean, ownsMarkers: boolean] | undefined {
  const current = borrowHydrationSlotRange(parent, true)
  if (current !== undefined) {
    claimHydrationSlotRange(parent)
    return [current[0], current[1], true, true]
  }
  if (borrowOuter) {
    const outer = borrowHydrationSlotRange(parent, false)
    if (outer !== undefined) return [outer[0], outer[1], true, false]
  }
  if (allowMarkerlessHydration && hydrationCursor(parent) !== undefined) return undefined
  const hydrated = claimHydrationSlotRange(parent)
  if (hydrated !== undefined) return [hydrated[0], hydrated[1], true, true]
  const start = document.createComment(DEV ? `vidact:${label}` : '')
  const end = document.createComment(DEV ? `/vidact:${label}` : '')
  parent.insertBefore(start, before)
  parent.insertBefore(end, before)
  return [start, end, false, true]
}

function subscribe(
  scope: CompiledScope,
  reads: SourceMask,
  run: () => void,
  additionalScope?: CompiledScope,
  additionalReads?: SourceMask,
): () => void {
  let first: (() => void) | undefined
  if (!isEmptySources(reads)) {
    const remove = scope[0](reads, run)
    if (remove !== noop) first = remove
  }
  let second: (() => void) | undefined
  if (
    additionalScope !== undefined &&
    additionalReads !== undefined &&
    !isEmptySources(additionalReads)
  ) {
    const additionalRun =
      scopeNamespaces.get(additionalScope) === scopeNamespaces.get(scope)
        ? run
        : () => withScopeNamespace(scope, run)
    const remove = additionalScope[0](additionalReads, additionalRun)
    if (remove !== noop) second = remove
  }
  if (first === undefined) return second ?? noop
  if (second === undefined) return first
  return () => {
    first()
    second()
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
      [],
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
    ? [false, [], context, rootIdentity, boundary, retainedConnection]
    : [false, [], context, rootIdentity, boundary]
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
        {
          context: context as CompiledContext<unknown>,
          input,
          parent: parentContext,
          owner: activeOwner,
        },
        () => insertValue(parent, children, before),
      )
    },
    'transparent',
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
  activeOwner?.[1].push(cleanup)
}

function disposeOwner(owner: Owner): void {
  if (owner[0]) return
  owner[0] = true
  disposalCascadeDepth += 1
  disposalCascadeOwners.add(owner)
  if (DEV) activeOwnerCount -= 1
  if (pendingInsertionCommits.delete(owner)) pendingInsertionOwnerCount -= 1
  if (pendingOwnerCommits.delete(owner)) pendingOwnerCommitCount -= 1
  let firstError: unknown
  let hasError = false
  try {
    for (let remaining = owner[1].length; remaining > 0; remaining -= 1) {
      const cleanup = owner[1].pop()
      try {
        cleanup?.()
      } catch (error) {
        if (!hasError) firstError = error
        hasError = true
      }
    }
    owner[1].length = 0
  } finally {
    disposalCascadeDepth -= 1
    if (disposalCascadeDepth === 0) disposalCascadeOwners.clear()
  }
  if (hasError) throw firstError
}

/** @internal Test-only allocation and retention evidence. */
export function readCompiledOwnerMetrics(): {
  readonly active: number
  readonly created: number
  readonly updaters: number
  readonly schedulerPlans: number
} {
  return {
    active: activeOwnerCount,
    created: createdOwnerCount,
    updaters: createdUpdaterCount,
    schedulerPlans: createdSchedulerPlanCount,
  }
}

/** @internal Test-only publication traversal evidence. */
export function readCompiledPublicationMetrics(): { readonly visitedNodes: number } {
  return { visitedNodes: visitedPublishedNodeCount }
}

interface MountedBindingState {
  start: Comment | null
  end: Comment | null
  current: unknown
  currentOwner: Owner | null
  text: Text | null
}

function ensureMountedBindingRange(state: MountedBindingState): readonly [Comment, Comment] {
  if (state.start !== null && state.end !== null) return [state.start, state.end]
  const anchor = state.text
  const parent = anchor?.parentNode
  if (anchor === null || parent === null || parent === undefined) {
    throw new Error(DEV ? 'markerless binding text is detached' : 'V010')
  }
  state.start = document.createComment(DEV ? 'vidact:binding' : '')
  state.end = document.createComment(DEV ? '/vidact:binding' : '')
  parent.insertBefore(state.start, anchor)
  parent.insertBefore(state.end, anchor.nextSibling)
  return [state.start, state.end]
}

function clearMountedBinding(state: MountedBindingState): void {
  const [start, end] = ensureMountedBindingRange(state)
  const owner = state.currentOwner
  state.currentOwner = null
  state.text = null
  disposeRange(owner, start, end)
}

function mountCompiledBindingBefore(
  parent: Node,
  value: CompiledBinding<unknown>,
  before: Node | null,
): void {
  const initial = value[1]()
  const scalarInitial = isScalarRenderValue(initial)
  const structuralInitial = ownedStructuralBinding(initial)
  const hydratedTextRange = scalarInitial
    ? claimHydrationTextRange(parent, toText(initial))
    : undefined
  const borrowedHydrationRange =
    isHydrating() && !scalarInitial
      ? borrowHydrationSlotRange(parent, structuralInitial?.[2] === 'slot')
      : undefined
  const hydratedStructuralRange =
    isHydrating() && !scalarInitial
      ? (borrowedHydrationRange ?? claimHydrationSlotRange(parent))
      : undefined
  const hydratedRange = hydratedTextRange ?? hydratedStructuralRange
  const markerlessScalar = hydratedRange === undefined && scalarInitial && !isHydrating()
  let start = hydratedRange?.[0] ?? null
  let end = hydratedRange?.[1] ?? null
  if (!markerlessScalar && hydratedRange === undefined) {
    start = document.createComment(DEV ? 'vidact:binding' : '')
    end = document.createComment(DEV ? '/vidact:binding' : '')
    parent.insertBefore(start, before)
    parent.insertBefore(end, before)
  }
  const state: MountedBindingState = {
    start,
    end,
    current: hydratedTextRange === undefined && !markerlessScalar ? UNSET_BINDING : initial,
    currentOwner: null,
    text: hydratedTextRange?.[2] ?? null,
  }
  if (markerlessScalar) {
    state.text = document.createTextNode(toText(initial))
    parent.insertBefore(state.text, before)
  }
  const update = (): void => {
    const next = value[1]()
    if (state.current !== UNSET_BINDING && Object.is(next, state.current)) return
    if (
      state.current !== UNSET_BINDING &&
      isRenderableProtocol(state.current) &&
      isRenderableProtocol(next) &&
      canReconcileRenderable(state.current) &&
      canReconcileRenderable(next) &&
      Object.is(renderableIdentity(state.current), renderableIdentity(next))
    ) {
      state.current = next
      return
    }
    if (isScalarRenderValue(next)) {
      const content = toText(next)
      if (state.text !== null) {
        const target = state.text
        const previousContent = target.data
        const previous = state.current
        stagePublication([
          () => {
            if (target.data !== content) target.data = content
            state.current = next
          },
          () => {
            if (target.data !== previousContent) target.data = previousContent
            state.current = previous
          },
        ])
        return
      }
      clearMountedBinding(state)
      const [rangeStart, rangeEnd] = ensureMountedBindingRange(state)
      const currentParent = rangeParent(rangeStart, rangeEnd, 'binding range')
      state.text = document.createTextNode(content)
      currentParent.insertBefore(state.text, rangeEnd)
      state.current = next
      return
    }

    const [rangeStart, rangeEnd] = ensureMountedBindingRange(state)
    const currentParent = rangeParent(rangeStart, rangeEnd, 'binding range')
    const nextOwner = createOwner()
    const stagedValue =
      isRenderableProtocol(next) && canReconcileRenderable(next)
        ? stableRenderableBinding(value, next)
        : (next as RenderValue)
    const [fragment, staged] = stageValue(stagedValue as RenderValue, nextOwner)
    try {
      clearMountedBinding(state)
    } catch (error) {
      disposeOwner(nextOwner)
      throw error
    }
    state.currentOwner = nextOwner
    currentParent.insertBefore(fragment, rangeEnd)
    commitPublishedNodes(staged)
    state.current = next
  }

  if (hydratedStructuralRange !== undefined) {
    const rangeEnd = hydratedStructuralRange[1]
    const nextOwner = createOwner()
    const [fragment, staged] = withHydrationInsertion(parent, rangeEnd, () =>
      stageRender(
        () =>
          (isRenderableProtocol(initial) && canReconcileRenderable(initial)
            ? stableRenderableBinding(value, initial)
            : initial) as RenderValue,
        nextOwner,
      ),
    )
    parent.insertBefore(fragment, rangeEnd)
    commitPublishedNodes(staged)
    state.currentOwner = nextOwner
    state.current = initial
  } else if (hydratedRange === undefined && !markerlessScalar) {
    update()
  }
  const removeUpdater = subscribeBinding(value, update)
  onCleanup(() => {
    removeUpdater()
    if (state.start === null || state.end === null) {
      state.text?.remove()
      state.text = null
      return
    }
    clearMountedBinding(state)
    if (borrowedHydrationRange === undefined) {
      state.start.remove()
      state.end.remove()
    }
  })
}

function stableRenderableBinding(
  value: CompiledBinding<unknown>,
  renderable: RenderableProtocol,
): unknown {
  const identity = renderableIdentity(renderable)
  let previous = renderablePropsSnapshot(renderable)
  const input = binding(
    value[2],
    value[3],
    () => {
      const next = value[1]()
      if (!isRenderableProtocol(next) || !Object.is(renderableIdentity(next), identity)) {
        return previous
      }
      previous = renderablePropsSnapshot(next)
      return previous
    },
    value[4],
    value[5],
  )
  return materializeRenderableWithInput(renderable, input)
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

function stageMarkerlessHydrationRender(
  parent: Node,
  before: Node | null,
  render: () => CompiledRenderValue,
  owner: Owner,
): readonly [first: Node | null, after: Node | null, nodes: readonly Node[]] {
  const first = hydrationCursor(parent)
  if (first === undefined) {
    throw new Error('markerless hydration render requires active hydration')
  }
  try {
    withHydrationInsertion(parent, before, () =>
      withOwner(owner, () => insertValue(parent, render(), before)),
    )
  } catch (error) {
    try {
      disposeOwner(owner)
    } catch {
      // Preserve the render or hydration error after every registered cleanup ran.
    }
    throw error
  }
  const after = hydrationCursor(parent)
  if (after === undefined) {
    disposeOwner(owner)
    throw new Error('markerless hydration render lost its hydration cursor')
  }
  const nodes: Node[] = []
  for (let node = first; node !== null && node !== after; node = node.nextSibling) {
    nodes.push(node)
  }
  return [first, after, nodes]
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
  if (pendingRefCount === 0) return
  visitNodes(root, (node) => {
    if (!(node instanceof Element)) return
    const pending = pendingRefs.get(node)
    if (pending === undefined || pending[0] !== null) return
    pending[0] = activeOwner
    activeOwner?.[1].push(() => deletePendingRef(node, pending))
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
  if (pendingInsertionOwnerCount > 0) {
    for (const node of nodes) commitNodeInsertions(node)
  }
  if (pendingRefCount > 0) {
    for (const node of nodes) commitNodeRefs(node)
  }
  if (pendingOwnerCommitCount > 0) {
    for (const node of nodes) commitNodeResources(node)
  }
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
        deletePendingRef(node, pending)
        const owner = pending[0] ?? activeOwner
        commitContextInsertions(owner?.[2] ?? null)
        commitOwnerInsertions(owner ?? undefined)
        const cleanup = attachRef(pending[1], node)
        if (pending[2] === undefined) owner?.[1].push(cleanup)
        else pending[2](cleanup)
      }
    }
  })
}

function commitContextInsertions(frame: ContextFrame | null): void {
  if (frame === null) return
  commitContextInsertions(frame.parent)
  commitOwnerInsertions(frame.owner ?? undefined)
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
  pendingInsertionOwnerCount -= 1
  for (const commit of commits) commit()
}

function commitOwnerResources(owner: Owner | undefined): void {
  if (owner === undefined || owner[0]) return
  const commits = pendingOwnerCommits.get(owner)
  if (commits === undefined) return
  pendingOwnerCommits.delete(owner)
  pendingOwnerCommitCount -= 1
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
  visitedPublishedNodeCount += 1
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

function scheduleFlush(flush: FlushTask): void {
  scheduledFlushes.add(flush)
  if (transactionDepth === 0) drainFlushes()
}

function scheduleOwnerFlush(owner: Owner, flush: FlushTask): void {
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
  const runs = new Map<FlushTask, number>()
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
      if (typeof flush === 'function') flush()
      else flush[1]()
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

export function isCompiledContext<Value>(value: unknown): value is CompiledContext<Value> {
  return typeof value === 'function' && CONTEXT in value
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
