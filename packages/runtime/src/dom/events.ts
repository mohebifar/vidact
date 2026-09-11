import { isReactFormChangeEvent, restoreControlledFormState } from './properties.ts'

const DEV = typeof __VIDACT_DEV__ === 'undefined' || __VIDACT_DEV__
const delegatedClick = Symbol('vidact.click')
const delegatedClickCursor = Symbol('vidact.click.cursor')
const delegatedClickRoots = new WeakMap<EventTarget, number>()
export const COMPILED_DELEGATED_EVENT_INVOKE = Symbol('vidact.compiled-event.invoke')

type DelegatedEventListener = EventListener & {
  [COMPILED_DELEGATED_EVENT_INVOKE]?: EventListener
}
type DelegatedClickElement = Element & { [delegatedClick]?: DelegatedEventListener }
type DelegatedClickEvent = Event & { [delegatedClickCursor]?: EventTarget }

function isSupportedReactEventName(name: string): boolean {
  return '|Abort|AnimationEnd|AnimationIteration|AnimationStart|AuxClick|BeforeInput|BeforeToggle|Blur|CanPlay|CanPlayThrough|Cancel|Change|Click|Close|CompositionEnd|CompositionStart|CompositionUpdate|ContextMenu|Copy|Cut|DoubleClick|Drag|DragEnd|DragEnter|DragExit|DragLeave|DragOver|DragStart|Drop|DurationChange|Emptied|Encrypted|Ended|Error|Focus|GotPointerCapture|Input|Invalid|KeyDown|KeyPress|KeyUp|Load|LoadedData|LoadedMetadata|LoadStart|LostPointerCapture|MouseDown|MouseEnter|MouseLeave|MouseMove|MouseOut|MouseOver|MouseUp|Paste|Pause|Play|Playing|PointerCancel|PointerDown|PointerEnter|PointerLeave|PointerMove|PointerOut|PointerOver|PointerUp|Progress|RateChange|Reset|Resize|Scroll|ScrollEnd|Seeked|Seeking|Select|Stalled|Submit|Suspend|TimeUpdate|Toggle|TouchCancel|TouchEnd|TouchMove|TouchStart|TransitionCancel|TransitionEnd|TransitionRun|TransitionStart|VolumeChange|Waiting|Wheel|'.includes(
    `|${name}|`,
  )
}

export function attachEventProp(element: Element, name: string, value: unknown): () => void {
  if (value === null || value === undefined) return () => {}
  if (typeof value !== 'function') {
    throw new TypeError(DEV ? `event prop ${name} must be a function, null, or undefined` : 'V201')
  }

  const reactEventName = name.slice(2)
  const capture = reactEventName.endsWith('Capture') && !reactEventName.endsWith('PointerCapture')
  const eventNameWithoutPhase = capture
    ? reactEventName.slice(0, -'Capture'.length)
    : reactEventName
  if (DEV && !isSupportedReactEventName(eventNameWithoutPhase)) {
    throw new TypeError(DEV ? `unsupported event prop ${name}` : 'V202')
  }
  if (eventNameWithoutPhase === 'Change') {
    return attachReactChangeEvent(element, value as EventListener, capture)
  }

  const eventName = nativeEventName(eventNameWithoutPhase)
  if (eventName === 'input') {
    const dispatch = (event: Event): void =>
      invokeFormListener(element, value as EventListener, event)
    element.addEventListener(eventName, dispatch, capture)
    return () => element.removeEventListener(eventName, dispatch, capture)
  }
  const dispatch = (event: Event): void => (value as EventListener)(reactShapedEvent(event))
  element.addEventListener(eventName, dispatch, capture)
  return () => element.removeEventListener(eventName, dispatch, capture)
}

export function attachCompiledEventProp(
  element: Element,
  name: string,
  value: unknown,
): () => void {
  if (name !== 'onClick') return attachEventProp(element, name, value)
  if (value === null || value === undefined) return () => {}
  if (typeof value !== 'function') {
    throw new TypeError(DEV ? `event prop ${name} must be a function, null, or undefined` : 'V201')
  }

  const target = element as DelegatedClickElement
  const listener = value as DelegatedEventListener
  target[delegatedClick] = listener
  return () => {
    if (target[delegatedClick] === listener) delete target[delegatedClick]
  }
}

export function retainCompiledEventRoot(root: EventTarget): () => void {
  const references = delegatedClickRoots.get(root) ?? 0
  if (references === 0) root.addEventListener('click', dispatchDelegatedClick)
  delegatedClickRoots.set(root, references + 1)
  let retained = true
  return () => {
    if (!retained) return
    retained = false
    const nextReferences = (delegatedClickRoots.get(root) ?? 1) - 1
    if (nextReferences > 0) {
      delegatedClickRoots.set(root, nextReferences)
      return
    }
    delegatedClickRoots.delete(root)
    root.removeEventListener('click', dispatchDelegatedClick)
  }
}

export function isEventProp(name: string): boolean {
  return /^on[A-Z]/.test(name)
}

function attachReactChangeEvent(
  element: Element,
  listener: EventListener,
  capture: boolean,
): () => void {
  const dispatch = (event: Event): void => {
    const target = event.target
    if (!(target instanceof Element) || !isReactFormChangeEvent(target, event.type)) return
    invokeFormListener(element, listener, event)
  }
  element.addEventListener('input', dispatch, capture)
  element.addEventListener('change', dispatch, capture)
  return () => {
    element.removeEventListener('input', dispatch, capture)
    element.removeEventListener('change', dispatch, capture)
  }
}

function invokeFormListener(element: Element, listener: EventListener, event: Event): void {
  try {
    listener(reactShapedEvent(event))
  } finally {
    const target = event.target as Element
    if (isReactFormChangeEvent(target, event.type) && (target === element || event.cancelBubble)) {
      restoreControlledFormState(target)
    }
  }
}

function reactShapedEvent(event: Event): Event {
  const shaped = event as Event & {
    nativeEvent?: Event
    isDefaultPrevented?: () => boolean
    isPropagationStopped?: () => boolean
    persist?: () => void
  }
  shaped.nativeEvent ??= event
  shaped.isDefaultPrevented ??= () => event.defaultPrevented
  shaped.isPropagationStopped ??= () => event.cancelBubble
  shaped.persist ??= () => {}
  return shaped
}

function dispatchDelegatedClick(event: Event): void {
  const root = event.currentTarget
  if (root === null) return
  const path = event.composedPath()
  const previousRoot = (event as DelegatedClickEvent)[delegatedClickCursor]
  const start = previousRoot === undefined ? 0 : path.indexOf(previousRoot) + 1
  for (let index = start; index < path.length; index += 1) {
    const target = path[index]
    if (target instanceof Element) {
      const listener = (target as DelegatedClickElement)[delegatedClick]
      if (listener !== undefined) invokeDelegatedClick(target, listener, event)
    }
    if (event.cancelBubble) break
    if (target === root) break
  }
  ;(event as DelegatedClickEvent)[delegatedClickCursor] = root
}

function invokeDelegatedClick(
  element: Element,
  listener: DelegatedEventListener,
  event: Event,
): void {
  const currentTarget = Object.getOwnPropertyDescriptor(event, 'currentTarget')
  Object.defineProperty(event, 'currentTarget', { configurable: true, value: element })
  try {
    const shapedEvent = reactShapedEvent(event)
    const compiledInvoke = listener[COMPILED_DELEGATED_EVENT_INVOKE]
    if (compiledInvoke === undefined) listener(shapedEvent)
    else compiledInvoke.call(listener, shapedEvent)
  } finally {
    if (currentTarget === undefined) {
      Reflect.deleteProperty(event, 'currentTarget')
    } else {
      Object.defineProperty(event, 'currentTarget', currentTarget)
    }
  }
}

function nativeEventName(reactEventName: string): string {
  if (reactEventName === 'DoubleClick') return 'dblclick'
  if (reactEventName === 'Focus') return 'focusin'
  if (reactEventName === 'Blur') return 'focusout'
  return reactEventName.toLowerCase()
}
