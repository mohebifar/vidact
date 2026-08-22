import {
  isCompiledBinding,
  isStructuralBinding,
  adoptCompiledRoot,
  constructCompiledComponent,
  mountCompiledBinding,
  mountCompiledProp,
  queueElementRef,
  type CompiledBinding,
  type StructuralBinding,
} from './compiled.ts'
import type { StateUpdate } from './state-slot.ts'

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
export type DirectComponent = (props: Record<string, unknown>) => Node

export interface MutableRef<T> {
  current: T
}

export const Fragment = Symbol('Vidact.Fragment')

interface StateHook {
  value: unknown
}

interface ComponentInstance {
  readonly hooks: StateHook[]
  cursor: number
  disposed: boolean
  render: () => void
}

let activeInstance: ComponentInstance | null = null
const MAX_RENDER_PASSES = 100

export function h<Tag extends keyof HTMLElementTagNameMap>(
  type: Tag,
  props: DirectProps,
  ...children: DirectChild[]
): HTMLElementTagNameMap[Tag]
export function h(
  type: string | typeof Fragment | DirectComponent,
  props: DirectProps,
  ...children: DirectChild[]
): Node
export function h(
  type: string | typeof Fragment | DirectComponent,
  props: DirectProps,
  ...children: DirectChild[]
): Node {
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
  applyProps(element, props)
  appendChildren(element, children)
  return element
}

export function useState<T>(initialValue: T | (() => T)): [T, (update: StateUpdate<T>) => void] {
  const instance = activeInstance
  if (instance === null) throw new Error('useState must run while a Vidact component renders')

  const index = instance.cursor
  instance.cursor += 1
  const existing = instance.hooks[index]
  const hook: StateHook = existing ?? {
    value: typeof initialValue === 'function' ? (initialValue as () => T)() : initialValue,
  }
  if (existing === undefined) instance.hooks.push(hook)

  const setValue = (update: StateUpdate<T>): void => {
    if (instance.disposed) return
    const previous = hook.value as T
    const next = typeof update === 'function' ? (update as (value: T) => T)(previous) : update
    if (Object.is(previous, next)) return
    hook.value = next
    instance.render()
  }

  return [hook.value as T, setValue]
}

export function useRef<T>(initialValue: T): MutableRef<T> {
  const instance = activeInstance
  if (instance === null) return { current: initialValue }

  const index = instance.cursor
  instance.cursor += 1
  const existing = instance.hooks[index]
  const hook: StateHook = existing ?? { value: { current: initialValue } }
  if (existing === undefined) instance.hooks.push(hook)
  return hook.value as MutableRef<T>
}

export function mount(component: () => Node, host: ParentNode): { dispose: () => void } {
  let currentRoot: Node | null = null
  let rendering = false
  let pending = false
  const instance: ComponentInstance = {
    hooks: [],
    cursor: 0,
    disposed: false,
    render: () => {},
  }

  instance.render = (): void => {
    if (instance.disposed) return
    if (rendering) {
      pending = true
      return
    }

    rendering = true
    try {
      let renderPasses = 0
      do {
        renderPasses += 1
        if (renderPasses > MAX_RENDER_PASSES) {
          throw new Error('Vidact component did not stabilize after 100 render passes')
        }
        pending = false
        instance.cursor = 0
        const previousInstance = activeInstance
        activeInstance = instance
        let nextRoot: Node
        try {
          nextRoot = component()
        } finally {
          activeInstance = previousInstance
        }

        if (currentRoot?.parentNode === host) {
          host.replaceChild(nextRoot, currentRoot)
        } else {
          host.replaceChildren(nextRoot)
        }
        currentRoot = nextRoot
      } while (pending)
    } finally {
      rendering = false
    }
  }

  instance.render()
  return {
    dispose: () => {
      if (instance.disposed) return
      instance.disposed = true
      host.replaceChildren()
      currentRoot = null
      instance.hooks.length = 0
    },
  }
}

function applyProps(element: HTMLElement, props: DirectProps): void {
  if (props === null) return
  for (const [name, value] of Object.entries(props)) {
    if (name === 'key' || value === null || value === undefined) continue
    if (name === 'ref') {
      if (isCompiledBinding(value)) {
        throw new Error('reactive ref identities are not supported')
      }
      queueElementRef(element, value)
      continue
    }
    if (isCompiledBinding(value)) {
      mountCompiledProp(value, (next) => applyProp(element, name, next))
      continue
    }
    applyProp(element, name, value)
  }
}

function applyProp(element: HTMLElement, name: string, value: unknown): void {
  const property = name === 'className' ? 'className' : name === 'htmlFor' ? 'htmlFor' : name
  if (value === null || value === undefined) {
    if (property in element && !name.startsWith('data-') && !name.startsWith('aria-')) {
      Reflect.set(element, property, property === 'value' ? '' : false)
    } else {
      element.removeAttribute(name)
    }
    return
  }
  if (name === 'dangerouslySetInnerHTML') {
    throw new Error('dangerouslySetInnerHTML is not supported by the direct DOM runtime')
  }
  if (name === 'style' && typeof value === 'object') {
    Object.assign(element.style, value)
    return
  }
  if (isEventProp(name) && typeof value === 'function') {
    const reactEventName = name.slice(2)
    const eventName = reactEventName === 'DoubleClick' ? 'dblclick' : reactEventName.toLowerCase()
    element.addEventListener(eventName, value as EventListener)
    return
  }

  if (property in element && !name.startsWith('data-') && !name.startsWith('aria-')) {
    Reflect.set(element, property, value)
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
