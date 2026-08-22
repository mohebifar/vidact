import {
  isCompiledBinding,
  isStructuralBinding,
  adoptCompiledRoot,
  constructCompiledComponent,
  mountCompiledBinding,
  mountCompiledProp,
  queueElementRef,
  registerCompiledCleanup,
  type CompiledBinding,
  type StructuralBinding,
} from './compiled.ts'
import { mountRawHtmlProp, validateRawHtmlRelatedProp } from './raw-html.ts'

export type DirectChild =
  | Node
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined
  | readonly DirectChild[]
  | CompiledBinding<unknown>
  | StructuralBinding
export type DirectProps = Record<string, unknown> | null
export type DirectComponent = (props: Record<string, unknown>) => DirectChild

export const Fragment = Symbol('Vidact.Fragment')

export function h<Tag extends keyof HTMLElementTagNameMap>(
  type: Tag,
  props: DirectProps,
  ...children: DirectChild[]
): HTMLElementTagNameMap[Tag]
export function h(
  type: typeof Fragment,
  props: DirectProps,
  ...children: DirectChild[]
): DocumentFragment
export function h(
  type: DirectComponent,
  props: DirectProps,
  ...children: DirectChild[]
): DirectChild
export function h(
  type: string | typeof Fragment | DirectComponent,
  props: DirectProps,
  ...children: DirectChild[]
): DirectChild
export function h(
  type: string | typeof Fragment | DirectComponent,
  props: DirectProps,
  ...children: DirectChild[]
): DirectChild {
  if (type === Fragment) {
    const fragment = document.createDocumentFragment()
    appendChildren(fragment, children)
    return fragment
  }
  if (typeof type === 'function') {
    const root = constructCompiledComponent(() => type({ ...props, children }))
    adoptCompiledRoot(root)
    return root
  }

  const element = document.createElement(type)
  applyProps(element, props, children)
  appendChildren(element, children)
  return element
}

function applyProps(
  element: HTMLElement,
  props: DirectProps,
  children: readonly DirectChild[],
): void {
  if (props === null) return
  const rawHtml = props.dangerouslySetInnerHTML
  for (const [name, value] of Object.entries(props)) {
    if (name === 'key' || value === null || value === undefined) continue
    if (name === 'dangerouslySetInnerHTML') continue
    if (name === 'ref') {
      if (isCompiledBinding(value)) {
        throw new Error('reactive ref identities are not supported')
      }
      queueElementRef(element, value)
      continue
    }
    if (isCompiledBinding(value)) {
      if (isEventProp(name)) {
        mountCompiledProp(value, (next) => attachEventProp(element, name, next))
        continue
      }
      mountCompiledProp(value, (next) => applyProp(element, name, next))
      continue
    }
    if (isEventProp(name) && typeof value === 'function') {
      registerCompiledCleanup(attachEventProp(element, name, value))
      continue
    }
    applyProp(element, name, value)
  }
  mountRawHtmlProp(element, rawHtml, children)
}

function attachEventProp(element: HTMLElement, name: string, value: unknown): () => void {
  if (value === null || value === undefined) return () => {}
  if (typeof value !== 'function') {
    throw new TypeError(`event prop ${name} must be a function, null, or undefined`)
  }
  const reactEventName = name.slice(2)
  const capture = reactEventName.endsWith('Capture')
  const eventNameWithoutPhase = capture
    ? reactEventName.slice(0, -'Capture'.length)
    : reactEventName
  const eventName =
    eventNameWithoutPhase === 'DoubleClick' ? 'dblclick' : eventNameWithoutPhase.toLowerCase()
  const listener = value as EventListener
  element.addEventListener(eventName, listener, capture)
  return () => element.removeEventListener(eventName, listener, capture)
}

function applyProp(element: HTMLElement, name: string, value: unknown): void {
  const property = name === 'className' ? 'className' : name === 'htmlFor' ? 'htmlFor' : name
  if (value === null || value === undefined) {
    if (property in element && !name.startsWith('data-') && !name.startsWith('aria-')) {
      Reflect.set(element, property, property === 'value' ? '' : false)
      validateRawHtmlRelatedProp(element, name)
    } else {
      element.removeAttribute(name)
    }
    return
  }
  if (name === 'dangerouslySetInnerHTML') {
    throw new Error('dangerouslySetInnerHTML must be handled as an owned opaque subtree')
  }
  if (name === 'style' && typeof value === 'object') {
    Object.assign(element.style, value)
    return
  }
  if (property in element && !name.startsWith('data-') && !name.startsWith('aria-')) {
    Reflect.set(element, property, value)
    validateRawHtmlRelatedProp(element, name)
  } else if (value === true) {
    element.setAttribute(name, '')
  } else if (value === false) {
    element.removeAttribute(name)
  } else {
    element.setAttribute(name, String(value))
  }
}

function isEventProp(name: string): boolean {
  const firstEventCharacter = name.charCodeAt(2)
  return name.startsWith('on') && firstEventCharacter >= 65 && firstEventCharacter <= 90
}

function appendChildren(parent: Node, children: readonly DirectChild[]): void {
  for (const child of children) appendChild(parent, child)
}

function appendChild(parent: Node, child: DirectChild): void {
  if (child === null || child === undefined || typeof child === 'boolean') return
  if (isStructuralBinding(child)) {
    child.mount(parent, null)
    return
  }
  if (isCompiledBinding(child)) {
    mountCompiledBinding(parent, child)
    return
  }
  if (Array.isArray(child)) {
    appendChildren(parent, child)
    return
  }
  if (child instanceof Node) {
    parent.appendChild(child)
    return
  }
  if (typeof child === 'object' || typeof child === 'function' || typeof child === 'symbol') {
    throw new TypeError('unsupported direct child value; expected a DOM node or owned block')
  }
  parent.appendChild(document.createTextNode(String(child)))
}
