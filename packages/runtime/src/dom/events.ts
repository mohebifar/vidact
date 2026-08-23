import { isReactFormChangeEvent } from './forms.ts'

export function attachEventProp(element: Element, name: string, value: unknown): () => void {
  if (value === null || value === undefined) return () => {}
  if (typeof value !== 'function') {
    throw new TypeError(`event prop ${name} must be a function, null, or undefined`)
  }

  const reactEventName = name.slice(2)
  const capture = reactEventName.endsWith('Capture')
  const eventNameWithoutPhase = capture
    ? reactEventName.slice(0, -'Capture'.length)
    : reactEventName
  const listener = value as EventListener

  if (eventNameWithoutPhase === 'Change') {
    return attachReactChangeEvent(element, listener, capture)
  }

  const eventName = nativeEventName(eventNameWithoutPhase)
  element.addEventListener(eventName, listener, capture)
  return () => element.removeEventListener(eventName, listener, capture)
}

export function isEventProp(name: string): boolean {
  const firstEventCharacter = name.charCodeAt(2)
  return name.startsWith('on') && firstEventCharacter >= 65 && firstEventCharacter <= 90
}

function attachReactChangeEvent(
  element: Element,
  listener: EventListener,
  capture: boolean,
): () => void {
  const dispatch = (event: Event): void => {
    const target = event.target
    if (!(target instanceof Element) || !isReactFormChangeEvent(target, event.type)) return
    listener(event)
  }
  element.addEventListener('input', dispatch, capture)
  element.addEventListener('change', dispatch, capture)
  return () => {
    element.removeEventListener('input', dispatch, capture)
    element.removeEventListener('change', dispatch, capture)
  }
}

function nativeEventName(reactEventName: string): string {
  if (reactEventName === 'DoubleClick') return 'dblclick'
  if (reactEventName === 'Focus') return 'focusin'
  if (reactEventName === 'Blur') return 'focusout'
  return reactEventName.toLowerCase()
}
