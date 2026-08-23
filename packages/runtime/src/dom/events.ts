import { isReactFormChangeEvent, restoreControlledFormState } from './forms.ts'

const DEV = typeof __VIDACT_DEV__ === 'undefined' || __VIDACT_DEV__

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
  element.addEventListener(eventName, value as EventListener, capture)
  return () => element.removeEventListener(eventName, value as EventListener, capture)
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
    listener(event)
  } finally {
    const target = event.target as Element
    if (isReactFormChangeEvent(target, event.type) && (target === element || event.cancelBubble)) {
      restoreControlledFormState(target)
    }
  }
}

function nativeEventName(reactEventName: string): string {
  if (reactEventName === 'DoubleClick') return 'dblclick'
  if (reactEventName === 'Focus') return 'focusin'
  if (reactEventName === 'Blur') return 'focusout'
  return reactEventName.toLowerCase()
}
