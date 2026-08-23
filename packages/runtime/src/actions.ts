import {
  captureCompiledTask,
  createContext,
  createCompiledExternalStore,
  createCompiledState,
  registerCompiledCleanup,
  runWithCompiledContext,
  useContext,
  type CompiledScope,
} from './compiled.ts'
import {
  registerTransitionAborter,
  registerTransitionFinalizer,
  registerTransitionSettlement,
  runUrgentUpdate,
  startIndependentTransition,
} from './concurrent.ts'
import { h, type DirectChild, type DirectProps } from './direct-dom.ts'
import { resetActionForm } from './dom/forms.ts'
import { installDomPropHandler } from './dom/properties.ts'
import type { SourceMask } from './source-mask.ts'
import type { StateSlot } from './state-slot.ts'

const DEV = typeof __VIDACT_DEV__ === 'undefined' || __VIDACT_DEV__
const FORM_ACTION_EXECUTE = Symbol(DEV ? 'Vidact.FormActionExecute' : undefined)

export interface FormStatus {
  readonly pending: boolean
  readonly data: FormData | null
  readonly method: 'get' | 'post'
  readonly action: FunctionFormAction | null
}

export type FunctionFormAction = (data: FormData) => unknown | PromiseLike<unknown>

type FormStatusStore = {
  current: FormStatus
  readonly listeners: Set<() => void>
}

type ActionFrame = {
  readonly settlements: Set<() => void>
}

type ActionDispatch<Payload> = {
  (payload: Payload): void
  readonly permalink?: string
  readonly [FORM_ACTION_EXECUTE]: (payload: Payload) => Promise<void>
}

type ActionQueueEntry<Payload> = {
  readonly payload: Payload
  readonly reportError: boolean
  readonly resolve: () => void
  readonly reject: (error: unknown) => void
}

type OptimisticLayer<Update> = {
  readonly frame: object
  readonly update: Update
  settling: boolean
}

export interface OptimisticSlot<Value, Update> {
  readonly get: () => Value
  readonly set: (update: Update) => void
}

const defaultFormStatus: FormStatus = {
  pending: false,
  data: null,
  method: 'get',
  action: null,
}
const functionActions = new WeakMap<Element, FunctionFormAction>()
const formStatusContext = createContext<FormStatusStore | undefined>(undefined)
let actionDomInstalled = false
let activeActionFrame: ActionFrame | undefined

export * from './index.ts'
export {
  createCompiledDeferred,
  createCompiledTransition,
  flushSync,
  startTransition,
  useDeferredValue,
  useTransition,
  type CompiledTransitionSlot,
} from './concurrent.ts'

export function createCompiledActionState<State, Payload>(
  scope: CompiledScope,
  stateSource: SourceMask,
  pendingSource: SourceMask,
  action: (previousState: State, payload: Payload) => State | PromiseLike<State>,
  initialState: State,
  permalink?: string,
): {
  readonly get: () => { readonly value: State; readonly pending: boolean }
  readonly set: ActionDispatch<Payload>
} {
  const state = createCompiledState(scope, stateSource, () => initialState)
  const pending = createCompiledState(scope, pendingSource, false)
  const task = captureCompiledTask(scope)
  const queue: ActionQueueEntry<Payload>[] = []
  let running = false

  const enqueue = (payload: Payload, reportError: boolean): Promise<void> => {
    runUrgentUpdate(() => pending.replace(true))
    return new Promise<void>((resolve, reject) => {
      queue.push({ payload, reportError, resolve, reject })
      processNext()
    })
  }

  const dispatch = ((payload: Payload): void => {
    void enqueue(payload, true)
  }) as ActionDispatch<Payload>
  Object.defineProperty(dispatch, FORM_ACTION_EXECUTE, {
    value: (payload: Payload) => enqueue(payload, false),
  })
  if (permalink !== undefined) Object.defineProperty(dispatch, 'permalink', { value: permalink })

  const processNext = (): void => {
    if (running) return
    const entry = queue.shift()
    if (entry === undefined) {
      runUrgentUpdate(() => pending.replace(false))
      return
    }
    running = true
    const frame = createActionFrame()
    let result: State | PromiseLike<State>
    const previousFrame = activeActionFrame
    activeActionFrame = frame
    try {
      result = action(state.get(), entry.payload)
    } catch (error) {
      activeActionFrame = previousFrame
      finishFailure(entry, frame, error)
      return
    }
    activeActionFrame = previousFrame
    void Promise.resolve(result).then(
      (nextState) => {
        if (task.disposed()) {
          entry.resolve()
          running = false
          return
        }
        runActionTransition(
          () => {
            state.replace(nextState)
            settleActionFrame(frame)
          },
          () => {
            entry.resolve()
            running = false
            processNext()
          },
        )
      },
      (error: unknown) => finishFailure(entry, frame, error),
    )
  }

  const finishFailure = (
    entry: ActionQueueEntry<Payload>,
    frame: ActionFrame,
    error: unknown,
  ): void => {
    if (task.disposed()) {
      entry.resolve()
      running = false
      return
    }
    runActionTransition(
      () => settleActionFrame(frame),
      () => {
        running = false
        if (entry.reportError) {
          entry.resolve()
          task.report(error)
        } else {
          entry.reject(error)
        }
        processNext()
      },
    )
  }

  return {
    get: () => ({ value: state.get(), pending: pending.get() }),
    set: dispatch,
  }
}

export function createCompiledOptimistic<Value, Update = Value>(
  scope: CompiledScope,
  reads: SourceMask,
  writes: SourceMask,
  evaluate: () => Value,
  reducer: (current: Value, update: Update) => Value = (_current, update) =>
    update as unknown as Value,
): OptimisticSlot<Value, Update> {
  const slot = createCompiledState(scope, writes, () => evaluate())
  let layers: OptimisticLayer<Update>[] = []
  const compute = (items = layers): Value =>
    items.reduce(
      (value, layer) => (layer.settling ? value : reducer(value, layer.update)),
      evaluate(),
    )
  scope[0](reads, () => slot.replace(compute()))

  const add = (update: Update): void => {
    const frame = activeActionFrame ?? {}
    const layer: OptimisticLayer<Update> = { frame, update, settling: false }
    layers.push(layer)
    try {
      runUrgentUpdate(() => slot.replace(compute()))
    } catch (error) {
      layers = layers.filter((item) => item !== layer)
      throw error
    }
    const settle = (): void => settleOptimisticFrame(frame)
    if (activeActionFrame !== undefined) {
      activeActionFrame.settlements.add(settle)
      return
    }
    if (registerTransitionSettlement(() => startIndependentTransition(settle))) return
    layers = layers.filter((item) => item !== layer)
    runUrgentUpdate(() => slot.replace(compute()))
    throw new Error(DEV ? 'optimistic updates must run inside an Action or transition' : 'V035')
  }

  const settleOptimisticFrame = (frame: object): void => {
    const settling = layers.filter((layer) => layer.frame === frame)
    if (settling.length === 0) return
    for (const layer of settling) layer.settling = true
    slot.replace(compute())
    if (
      registerTransitionFinalizer(() => {
        layers = layers.filter((layer) => layer.frame !== frame)
      })
    ) {
      registerTransitionAborter(() => {
        for (const layer of settling) layer.settling = false
      })
      return
    }
    layers = layers.filter((layer) => layer.frame !== frame)
  }

  return { get: slot.get, set: add }
}

export function createCompiledFormStatus(
  scope: CompiledScope,
  sourceMask: SourceMask,
): StateSlot<FormStatus> {
  const store = useContext(formStatusContext)
  if (store === undefined) return createCompiledState(scope, sourceMask, () => defaultFormStatus)
  return createCompiledExternalStore(
    scope,
    sourceMask,
    (notify) => {
      store.listeners.add(notify)
      return () => store.listeners.delete(notify)
    },
    () => store.current,
  )
}

export function ActionForm(props: DirectProps): DirectChild {
  ensureActionDom()
  const task = captureCompiledTask()
  const store: FormStatusStore = { current: defaultFormStatus, listeners: new Set() }
  const children = normalizeChildren(props?.children)
  const form = runWithCompiledContext(formStatusContext, store, () =>
    h('form', props, ...children),
  ) as HTMLFormElement
  let activeSubmissions = 0
  let latestSubmission = 0
  let latestSucceeded = false
  const submit = (event: SubmitEvent): void => {
    const submitter = event.submitter
    const hasSubmitterOverride =
      submitter instanceof Element &&
      (functionActions.has(submitter) || submitter.hasAttribute('formaction'))
    const action = hasSubmitterOverride
      ? functionActions.get(submitter as Element)
      : functionActions.get(form)
    if (action === undefined) return
    event.preventDefault()
    const submission = latestSubmission + 1
    latestSubmission = submission
    activeSubmissions += 1
    const data = createFormData(form, submitter)
    publishFormStatus(store, {
      pending: true,
      data,
      method: 'post',
      action,
    })
    const frame = createActionFrame()
    let result: unknown
    const previousFrame = activeActionFrame
    activeActionFrame = frame
    try {
      result = executeFormAction(action, data)
    } catch (error) {
      activeActionFrame = previousFrame
      finishFormAction(submission, false, frame, error)
      return
    }
    activeActionFrame = previousFrame
    void Promise.resolve(result).then(
      () => finishFormAction(submission, true, frame),
      (error: unknown) => finishFormAction(submission, false, frame, error),
    )
  }
  const finishFormAction = (
    submission: number,
    succeeded: boolean,
    frame: ActionFrame,
    error?: unknown,
  ): void => {
    if (task.disposed()) return
    runActionTransition(
      () => settleActionFrame(frame),
      () => {
        activeSubmissions -= 1
        if (submission === latestSubmission) latestSucceeded = succeeded
        if (activeSubmissions === 0) {
          if (latestSucceeded) resetActionForm(form)
          publishFormStatus(store, defaultFormStatus)
        }
        if (!succeeded) task.report(error)
      },
    )
  }
  form.addEventListener('submit', submit)
  registerCompiledCleanup(() => form.removeEventListener('submit', submit))
  return form
}

export function compiledFormAction<Value>(value: Value): Value {
  ensureActionDom()
  return value
}

export function useActionState(): never {
  throw new Error(DEV ? 'useActionState requires compiler lowering' : 'V036')
}

export function useOptimistic(): never {
  throw new Error(DEV ? 'useOptimistic requires compiler lowering' : 'V037')
}

export function useFormStatus(): never {
  throw new Error(DEV ? 'useFormStatus requires compiler lowering' : 'V038')
}

function createActionFrame(): ActionFrame {
  return { settlements: new Set() }
}

function settleActionFrame(frame: ActionFrame): void {
  for (const settle of frame.settlements) settle()
  if (!registerTransitionFinalizer(() => frame.settlements.clear())) frame.settlements.clear()
}

function runActionTransition(stage: () => void, complete: () => void): void {
  let committed = false
  startIndependentTransition(() => {
    stage()
    registerTransitionFinalizer(() => {
      committed = true
    })
    registerTransitionSettlement(() => {
      if (committed) {
        complete()
      } else {
        queueMicrotask(() => runActionTransition(stage, complete))
      }
    })
  })
}

function ensureActionDom(): void {
  if (actionDomInstalled) return
  actionDomInstalled = true
  installDomPropHandler((element, name, value) => {
    const valid =
      (name === 'action' && element instanceof HTMLFormElement) ||
      (name === 'formAction' &&
        (element instanceof HTMLButtonElement || element instanceof HTMLInputElement))
    if (!valid) return false
    if (typeof value !== 'function') {
      functionActions.delete(element)
      return false
    }
    functionActions.set(element, value as FunctionFormAction)
    element.removeAttribute(name === 'action' ? 'action' : 'formaction')
    return true
  })
}

function executeFormAction(action: FunctionFormAction, data: FormData): unknown {
  const specialized = (action as Partial<ActionDispatch<FormData>>)[FORM_ACTION_EXECUTE]
  return specialized === undefined ? action(data) : specialized(data)
}

function createFormData(form: HTMLFormElement, submitter: HTMLElement | null): FormData {
  return submitter === null ? new FormData(form) : new FormData(form, submitter)
}

function publishFormStatus(store: FormStatusStore, status: FormStatus): void {
  store.current = status
  for (const listener of store.listeners) listener()
}

function normalizeChildren(value: unknown): DirectChild[] {
  if (value === undefined) return []
  return (Array.isArray(value) ? value : [value]) as DirectChild[]
}
