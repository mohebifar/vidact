import { isHydrating } from '../hydration-bridge.ts'
import { UNITLESS_STYLE_PROPERTIES } from './style-properties.ts'

const DEV = typeof __VIDACT_DEV__ === 'undefined' || __VIDACT_DEV__
let retainedUiEnabled = typeof __VIDACT_RETAINED_UI__ !== 'undefined' && __VIDACT_RETAINED_UI__

/** @internal */
export function enableRetainedUiStyles(): void {
  retainedUiEnabled = true
}

const appliedStyleNames = new WeakMap<Element, Set<string>>()

export function applyStyleProp(element: Element, value: unknown): void {
  const style = Reflect.get(element, 'style')
  if (!(style instanceof CSSStyleDeclaration)) {
    throw new TypeError(
      DEV ? 'style is only supported on elements with CSS style declarations' : 'V501',
    )
  }
  if (value !== null && value !== undefined && typeof value !== 'object') {
    throw new TypeError(DEV ? 'style prop expects an object, null, or undefined' : 'V502')
  }

  const previous = appliedStyleNames.get(element) ?? new Set<string>()
  const nextEntries =
    value === null || value === undefined ? [] : Object.entries(value as Record<string, unknown>)
  const nextNames = new Set<string>()
  for (const [name] of nextEntries) nextNames.add(name)

  for (const name of previous) {
    if (!nextNames.has(name)) setStyleValue(style, name, '')
  }
  for (const [name, next] of nextEntries) {
    const serialized = serializeStyleValue(name, next)
    if (
      !retainedUiEnabled ||
      !isHydrating() ||
      hydrationStyleValue(element, style, name) !== serialized
    ) {
      setStyleValue(style, name, serialized)
    }
  }

  if (nextNames.size === 0) {
    appliedStyleNames.delete(element)
    if (element.getAttribute('style') === '') element.removeAttribute('style')
  } else {
    appliedStyleNames.set(element, nextNames)
  }
}

function hydrationStyleValue(element: Element, style: CSSStyleDeclaration, name: string): string {
  if (
    name === 'display' &&
    style.display === 'none' &&
    style.getPropertyPriority('display') === 'important'
  ) {
    const cssText = element.getAttribute('style')
    const hiddenDeclaration = 'display:none!important'
    if (cssText?.endsWith(hiddenDeclaration)) {
      const authored = document.createElement('div').style
      authored.cssText = cssText.slice(0, -hiddenDeclaration.length)
      return authored.display
    }
  }
  if (name.startsWith('--') || name.includes('-')) return style.getPropertyValue(name)
  return String(Reflect.get(style, name === 'float' ? 'cssFloat' : name) ?? '')
}

function serializeStyleValue(name: string, value: unknown): string {
  if (value === null || value === undefined || typeof value === 'boolean' || value === '') return ''
  if (name.startsWith('--')) return String(value).trim()
  if (typeof value === 'number' && value !== 0 && !UNITLESS_STYLE_PROPERTIES.has(name)) {
    return `${value}px`
  }
  return String(value).trim()
}

function setStyleValue(style: CSSStyleDeclaration, name: string, value: string): void {
  if (name.startsWith('--') || name.includes('-')) {
    style.setProperty(name, value)
    return
  }
  Reflect.set(style, name === 'float' ? 'cssFloat' : name, value)
}
