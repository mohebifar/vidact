import {
  isCompiledBinding,
  isStructuralBinding,
  adoptCompiledRoot,
  constructCompiledComponent,
  mountCompiledBinding,
  mountCompiledProp,
  mountCompiledPropTransition,
  queueElementRef,
  registerCompiledCleanup,
  type CompiledBinding,
  type StructuralBinding,
} from './compiled.ts'
import { attachEventProp, isEventProp } from './dom/events.ts'
import {
  ensureControlledFormRestoration,
  isControlledFormProp,
  restoreControlledFormState,
} from './dom/forms.ts'
import {
  INTERNAL_NAMESPACE_PROP,
  createComponentProps,
  createIntrinsicElement,
  readIntrinsicNamespace,
  withIntrinsicNamespace,
} from './dom/namespace.ts'
import { applyDomProp } from './dom/properties.ts'
import { mountRawHtmlProp } from './raw-html.ts'

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
    const namespace = readIntrinsicNamespace(props)
    const root = constructCompiledComponent(() =>
      withIntrinsicNamespace(namespace, () => type(createComponentProps(props, children))),
    )
    adoptCompiledRoot(root)
    return root
  }

  const namespace = readIntrinsicNamespace(props)
  const element = createIntrinsicElement(document, type, namespace)
  const restoreAfterChildren = applyProps(element, props, children)
  appendChildren(element, children)
  if (restoreAfterChildren) restoreControlledFormState(element)
  return element
}

function applyProps(
  element: Element,
  props: DirectProps,
  children: readonly DirectChild[],
): boolean {
  if (props === null) return false
  const rawHtml = props.dangerouslySetInnerHTML
  let restoreAfterChildren = false
  let hasControlledRestoration = false
  for (const [name, value] of Object.entries(props)) {
    if (name === 'key' || name === INTERNAL_NAMESPACE_PROP) continue
    if (name === 'dangerouslySetInnerHTML') continue
    if (!hasControlledRestoration && isControlledFormProp(element, name)) {
      registerCompiledCleanup(ensureControlledFormRestoration(element))
      hasControlledRestoration = true
    }
    if (name === 'value' && element instanceof HTMLSelectElement) restoreAfterChildren = true
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
      if (element instanceof HTMLSelectElement && name === 'multiple') {
        mountCompiledPropTransition(
          value,
          (initial) => applyDomProp(element, name, initial),
          (next, previous) => ({
            priority: -1,
            commit: () => applyDomProp(element, name, next),
            rollback: () => applyDomProp(element, name, previous),
            finalize: () => restoreControlledFormState(element),
          }),
        )
        continue
      }
      mountCompiledProp(value, (next) => applyDomProp(element, name, next))
      continue
    }
    if (isEventProp(name)) {
      registerCompiledCleanup(attachEventProp(element, name, value))
      continue
    }
    applyDomProp(element, name, value)
  }
  if (rawHtml === null || rawHtml === undefined) return restoreAfterChildren
  if (!(element instanceof HTMLElement)) {
    throw new Error('dangerouslySetInnerHTML on SVG and MathML elements is not supported')
  }
  mountRawHtmlProp(element, rawHtml, children)
  return restoreAfterChildren
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
