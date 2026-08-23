import { createCompiledState, runCompiledTransaction, type CompiledScope } from './compiled.ts'
import { flushScheduledTasks, scheduleDeferredTask, type CancelScheduledTask } from './scheduler.ts'
import type { SourceMask } from './source-mask.ts'
import {
  installStateWriteInterceptor,
  type DeferredStateWrite,
  type StateSlot,
  type StateUpdate,
} from './state-slot.ts'

const DEV = typeof __VIDACT_DEV__ === 'undefined' || __VIDACT_DEV__

type TransitionAction = () => void | PromiseLike<void>

type StagedSlot = {
  readonly revision: number
  readonly currentRevision: () => number
  readonly commit: (update: StateUpdate<unknown>) => void
  readonly updates: StateUpdate<unknown>[]
}

type TransitionWork = {
  readonly lane: TransitionLane
  readonly generation: number
  readonly slots: Map<object, StagedSlot>
  readonly settled: Set<() => void>
  readonly finalizers: Set<() => void>
  readonly aborters: Set<() => void>
  cancelTask: CancelScheduledTask | undefined
  awaiting: number
  committed: boolean
  canceled: boolean
  finished: boolean
}

type TransitionLane = {
  generation: number
  current: TransitionWork | undefined
  readonly pending: (value: boolean) => void
}

export interface CompiledTransitionSlot {
  readonly get: () => boolean
  readonly set: (action: TransitionAction) => void
}

let activeTransition: TransitionWork | undefined
let schedulerInstalled = false
const globalLane = createLane(() => {})

export * from './index.ts'

export function startTransition(action: TransitionAction): void {
  ensureConcurrentScheduler()
  startLaneTransition(globalLane, action)
}

export function flushSync<Result>(operation?: () => Result): Result | undefined {
  ensureConcurrentScheduler()
  const previous = activeTransition
  activeTransition = undefined
  try {
    const result = operation?.()
    flushScheduledTasks()
    return result
  } finally {
    activeTransition = previous
  }
}

export function createCompiledTransition(
  scope: CompiledScope,
  sourceMask: SourceMask,
): CompiledTransitionSlot {
  ensureConcurrentScheduler()
  const pending = createCompiledState(scope, sourceMask, false)
  const lane = createLane((value) => runUrgent(() => pending.replace(value)))
  return {
    get: pending.get,
    set: (action) => startLaneTransition(lane, action),
  }
}

export function createCompiledDeferred<Value>(
  scope: CompiledScope,
  reads: SourceMask,
  writes: SourceMask,
  evaluate: () => Value,
  initialValue?: Value,
): StateSlot<Value> {
  ensureConcurrentScheduler()
  const slot = createCompiledState(
    scope,
    writes,
    arguments.length >= 5 ? initialValue! : evaluate(),
  )
  const lane = createLane(() => {})
  const update = (): void => {
    startLaneTransition(lane, () => slot.replace(evaluate()))
  }
  scope[0](reads, update)
  if (arguments.length >= 5) update()
  return slot
}

export function useTransition(): never {
  throw new Error(DEV ? 'useTransition requires compiler lowering' : 'V032')
}

export function useDeferredValue<Value>(_value: Value, _initialValue?: Value): never {
  throw new Error(DEV ? 'useDeferredValue requires compiler lowering' : 'V033')
}

/** @internal */
export function registerTransitionSettlement(settle: () => void): boolean {
  if (activeTransition === undefined) return false
  activeTransition.settled.add(settle)
  return true
}

/** @internal */
export function registerTransitionFinalizer(finalize: () => void): boolean {
  if (activeTransition === undefined) return false
  activeTransition.finalizers.add(finalize)
  return true
}

/** @internal */
export function registerTransitionAborter(abort: () => void): boolean {
  if (activeTransition === undefined) return false
  activeTransition.aborters.add(abort)
  return true
}

/** @internal */
export function runUrgentUpdate<Result>(operation: () => Result): Result {
  return runUrgent(operation)
}

/** @internal */
export function startIndependentTransition(action: TransitionAction): void {
  ensureConcurrentScheduler()
  const previous = activeTransition
  activeTransition = undefined
  try {
    startLaneTransition(
      createLane(() => {}),
      action,
    )
  } finally {
    activeTransition = previous
  }
}

function createLane(pending: (value: boolean) => void): TransitionLane {
  return { generation: 0, current: undefined, pending }
}

function ensureConcurrentScheduler(): void {
  if (schedulerInstalled) return
  schedulerInstalled = true
  installStateWriteInterceptor(stageStateWrite)
}

function startLaneTransition(lane: TransitionLane, action: TransitionAction): void {
  if (activeTransition !== undefined) {
    lane.pending(true)
    activeTransition.settled.add(() => lane.pending(false))
    runTransitionAction(activeTransition, action)
    return
  }

  cancelWork(lane.current, true)
  lane.generation += 1
  lane.pending(true)
  const work: TransitionWork = {
    lane,
    generation: lane.generation,
    slots: new Map(),
    settled: new Set(),
    finalizers: new Set(),
    aborters: new Set(),
    cancelTask: undefined,
    awaiting: 0,
    committed: false,
    canceled: false,
    finished: false,
  }
  lane.current = work
  const previous = activeTransition
  activeTransition = work
  try {
    runTransitionAction(work, action)
  } catch (error) {
    cancelWork(work)
    throw error
  } finally {
    activeTransition = previous
  }
  work.cancelTask = scheduleDeferredTask(() => commitWork(work))
}

function runTransitionAction(work: TransitionWork, action: TransitionAction): void {
  const result = action()
  if (!isPromiseLike(result)) return
  work.awaiting += 1
  void Promise.resolve(result).then(
    () => {
      work.awaiting -= 1
      finishWork(work)
    },
    (error: unknown) => {
      work.awaiting -= 1
      cancelWork(work)
      queueMicrotask(() => {
        throw error
      })
    },
  )
}

function stageStateWrite<Value>(write: DeferredStateWrite<Value>): boolean {
  const work = activeTransition
  if (work === undefined || work.canceled) return false
  let staged = work.slots.get(write.slot)
  if (staged === undefined) {
    staged = {
      revision: write.revision,
      currentRevision: write.currentRevision,
      commit: write.commit as (update: StateUpdate<unknown>) => void,
      updates: [],
    }
    work.slots.set(write.slot, staged)
  }
  staged.updates.push(write.update as StateUpdate<unknown>)
  return true
}

function commitWork(work: TransitionWork): void {
  work.cancelTask = undefined
  if (
    work.canceled ||
    work.lane.current !== work ||
    work.lane.generation !== work.generation ||
    [...work.slots.values()].some((slot) => slot.currentRevision() !== slot.revision)
  ) {
    cancelWork(work)
    return
  }
  const previous = activeTransition
  activeTransition = undefined
  try {
    runCompiledTransaction(() => {
      for (const slot of work.slots.values()) {
        for (const update of slot.updates) slot.commit(update)
      }
    })
    for (const finalize of work.finalizers) finalize()
    work.finalizers.clear()
    work.aborters.clear()
    work.committed = true
  } catch (error) {
    cancelWork(work)
    throw error
  } finally {
    activeTransition = previous
    finishWork(work)
  }
}

function cancelWork(work: TransitionWork | undefined, preserveLanePending = false): void {
  if (work === undefined || work.finished) return
  work.canceled = true
  work.cancelTask?.()
  work.cancelTask = undefined
  work.finalizers.clear()
  for (const abort of work.aborters) abort()
  work.aborters.clear()
  work.committed = true
  work.awaiting = 0
  if (preserveLanePending && work.lane.current === work) work.lane.current = undefined
  finishWork(work)
}

function finishWork(work: TransitionWork): void {
  if (work.finished || !work.committed || work.awaiting > 0) return
  work.finished = true
  if (work.lane.current === work) {
    work.lane.current = undefined
    work.lane.pending(false)
  }
  for (const settle of work.settled) settle()
  work.settled.clear()
}

function runUrgent<Result>(operation: () => Result): Result {
  const previous = activeTransition
  activeTransition = undefined
  try {
    return operation()
  } finally {
    activeTransition = previous
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<void> {
  return (
    ((typeof value === 'object' && value !== null) || typeof value === 'function') &&
    typeof (value as PromiseLike<void>).then === 'function'
  )
}
