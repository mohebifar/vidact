import {
  isCompiledBinding,
  isStructuralBinding,
  hasInvalidChild,
  adoptCompiledRoot,
  constructCompiledComponent,
  mountCompiledBinding,
  mountCompiledProp,
  mountCompiledRef,
  mountCompiledPropTransition,
  queueElementRef,
  registerCompiledCleanup,
  type CompiledBinding,
  type CompiledRenderValue,
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
  intrinsicChildrenNamespace,
  readIntrinsicNamespace,
  resolveIntrinsicNamespace,
  withIntrinsicNamespace,
} from './dom/namespace.ts'
import { applyDomProp } from './dom/properties.ts'
import { mountRawHtmlProp } from './raw-html.ts'

const DEV = typeof __VIDACT_DEV__ === 'undefined' || __VIDACT_DEV__
const UNSAFE_HTML = typeof __VIDACT_UNSAFE_HTML__ === 'undefined' || __VIDACT_UNSAFE_HTML__

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
export type DirectComponent = (props: Record<string, unknown>) => CompiledRenderValue

export const Fragment = Symbol(DEV ? 'Vidact.Fragment' : undefined)

export function h<Tag extends keyof HTMLElementTagNameMap>(
  type: Tag,
  props: DirectProps,
  ...children: DirectChild[]
): HTMLElementTagNameMap[Tag]
export function h<Tag extends keyof MathMLElementTagNameMap>(
  type: Tag,
  props: DirectProps,
  ...children: DirectChild[]
): MathMLElementTagNameMap[Tag]
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

  const namespace = resolveIntrinsicNamespace(type, readIntrinsicNamespace(props))
  const element = createIntrinsicElement(document, type, namespace)
  const restoreAfterChildren = applyProps(element, props, children)
  withIntrinsicNamespace(intrinsicChildrenNamespace(type, namespace), () =>
    appendChildren(element, children),
  )
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
  for (const name in props) {
    if (!Object.hasOwn(props, name)) continue
    const value = props[name]
    if (name === 'key' || name === 'children' || name === INTERNAL_NAMESPACE_PROP) continue
    if (name === 'dangerouslySetInnerHTML') continue
    if (!hasControlledRestoration && isControlledFormProp(element, name)) {
      registerCompiledCleanup(ensureControlledFormRestoration(element))
      hasControlledRestoration = true
    }
    if (name === 'value' && element instanceof HTMLSelectElement) restoreAfterChildren = true
    if (name === 'ref') {
      if (isCompiledBinding(value)) {
        mountCompiledRef(element, value)
        continue
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
          // oxlint-disable no-sparse-arrays -- Preserve the compact positional ABI.
          (next, previous) => [
            () => applyDomProp(element, name, next),
            () => {
              applyDomProp(element, name, previous)
              restoreControlledFormState(element)
            },
            ,
            () => restoreControlledFormState(element),
            -1,
          ],
          // oxlint-enable no-sparse-arrays
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
    throw new Error(
      DEV ? 'dangerouslySetInnerHTML on SVG and MathML elements is not supported' : 'V102',
    )
  }
  if (!UNSAFE_HTML) {
    throw new Error(
      DEV ? 'dangerouslySetInnerHTML requires the unsafe-html compiler feature' : 'V104',
    )
  }
  mountRawHtmlProp(element, rawHtml, children)
  return restoreAfterChildren
}

function appendChildren(parent: Node, children: readonly DirectChild[]): void {
  if (hasInvalidChild(children)) {
    throw new TypeError(
      DEV ? 'unsupported direct child value; expected a DOM node or owned block' : 'V103',
    )
  }
  for (const child of children) appendChild(parent, child)
}

function appendChild(parent: Node, child: DirectChild): void {
  if (child === null || child === undefined || typeof child === 'boolean') return
  if (isStructuralBinding(child)) {
    child[1](parent, null)
    return
  }
  if (isCompiledBinding(child)) {
    mountCompiledBinding(parent, child)
    return
  }
  if (Array.isArray(child)) {
    for (const item of child) appendChild(parent, item)
    return
  }
  if (child instanceof Node) {
    parent.appendChild(child)
    return
  }
  if (typeof child === 'object' || typeof child === 'function' || typeof child === 'symbol') {
    throw new TypeError(
      DEV ? 'unsupported direct child value; expected a DOM node or owned block' : 'V103',
    )
  }
  parent.appendChild(document.createTextNode(String(child)))
}
