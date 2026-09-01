import {
  isCompiledBinding,
  isStructuralBinding,
  adoptCompiledRoot,
  constructCompiledComponent,
  mountCompiledBinding,
  mountCompiledProp,
  mountCompiledRef,
  mountCompiledPropTransition,
  queueElementRef,
  registerCompiledCleanup,
} from './compiled/core.ts'
import type { CompiledBinding, CompiledRenderValue, StructuralBinding } from './compiled/types.ts'
import { hasInvalidChild } from './compiled/validation.ts'
import { attachEventProp, isEventProp } from './dom/events.ts'
import {
  INTERNAL_NAMESPACE_PROP,
  createComponentProps,
  createIntrinsicElement,
  intrinsicChildrenNamespace,
  readIntrinsicNamespace,
  resolveIntrinsicNamespace,
  withIntrinsicNamespace,
} from './dom/intrinsic.ts'
import { intrinsicNamespaceUrl } from './dom/namespaces.ts'
import {
  applyDomProp,
  ensureControlledFormRestoration,
  isControlledFormProp,
  restoreControlledFormState,
} from './dom/properties.ts'
import {
  claimHydrationElement,
  claimHydrationArrayRange,
  claimHydrationNode,
  claimHydrationText,
  createHydrationFragment,
  finishHydrationArrayRange,
  hydrationFragmentChildren,
  isHydrating,
} from './hydration-bridge.ts'
import { mountRawHtmlProp } from './raw-html.ts'
import { isRenderableProtocol, materializeRenderable } from './renderable-protocol.ts'

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

export const Fragment: symbol = Symbol.for('vidact.v1.Fragment')
let frameworkMetadataHandler: ((element: Element, props: DirectProps) => Node) | undefined

/** @internal */
export function installFrameworkMetadata(
  handler: (element: Element, props: DirectProps) => Node,
): void {
  frameworkMetadataHandler = handler
}

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
  if (typeof type === 'symbol') {
    if (isHydrating()) return createHydrationFragment(children)
    const fragment = document.createDocumentFragment()
    appendChildren(fragment, children)
    return fragment
  }
  if (typeof type === 'function') {
    const namespace = readIntrinsicNamespace(props)
    const root = constructCompiledComponent(
      () => withIntrinsicNamespace(namespace, () => type(createComponentProps(props, children))),
      type,
    )
    adoptCompiledRoot(root)
    return root
  }

  const namespace = resolveIntrinsicNamespace(type, readIntrinsicNamespace(props))
  const namespaceUrl = intrinsicNamespaceUrl(namespace)
  const element =
    claimHydrationElement(type, namespaceUrl, (candidate) =>
      matchesHydrationElement(candidate, props, children),
    ) ?? createIntrinsicElement(document, type, namespace)
  const restoreAfterChildren = applyProps(element, props, children)
  withIntrinsicNamespace(intrinsicChildrenNamespace(type, namespace), () =>
    appendChildren(element, children),
  )
  if (restoreAfterChildren) restoreControlledFormState(element)
  if (frameworkMetadataHandler !== undefined && namespace === 'html') {
    return frameworkMetadataHandler(element, props)
  }
  return element
}

export function createElement(
  type: string | typeof Fragment | DirectComponent,
  props: DirectProps,
  ...children: DirectChild[]
): DirectChild {
  if (children.length === 0 && props !== null && Object.hasOwn(props, 'children')) {
    return h(type, props, props.children as DirectChild)
  }
  return h(type, props, ...children)
}

function matchesHydrationElement(
  element: Element,
  props: DirectProps,
  children: readonly DirectChild[],
): boolean {
  const classInput = props?.className
  const expectedClass = isCompiledBinding(classInput) ? classInput[1]() : classInput
  if (typeof expectedClass === 'string' && element.getAttribute('class') !== expectedClass) {
    return false
  }
  const idInput = props?.id
  const expectedId = isCompiledBinding(idInput) ? idInput[1]() : idInput
  if (typeof expectedId === 'string' && element.getAttribute('id') !== expectedId) return false

  const expectedNodes: Node[] = []
  collectHydrationChildNodes(children, expectedNodes)
  if (expectedNodes.some((node) => !element.contains(node))) return false

  const expectedText = staticHydrationText(children)
  return expectedText === undefined || element.textContent === expectedText
}

function collectHydrationChildNodes(children: readonly DirectChild[], nodes: Node[]): void {
  for (const child of children) {
    if (Array.isArray(child)) {
      collectHydrationChildNodes(child, nodes)
      continue
    }
    if (child instanceof DocumentFragment) {
      const fragmentChildren = hydrationFragmentChildren(child)
      if (fragmentChildren !== undefined) {
        collectHydrationChildNodes(fragmentChildren as readonly DirectChild[], nodes)
      }
      continue
    }
    if (child instanceof Node) nodes.push(child)
  }
}

function staticHydrationText(children: readonly DirectChild[]): string | undefined {
  let text = ''
  for (const child of children) {
    if (Array.isArray(child)) {
      const nested = staticHydrationText(child)
      if (nested === undefined) return undefined
      text += nested
      continue
    }
    if (child === null || child === undefined || typeof child === 'boolean') continue
    if (isCompiledBinding(child)) {
      const value = child[1]()
      if (value === null || value === undefined || typeof value === 'boolean') continue
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
        text += String(value)
        continue
      }
      return undefined
    }
    if (typeof child === 'string' || typeof child === 'number' || typeof child === 'bigint') {
      text += String(child)
      continue
    }
    return undefined
  }
  return text
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
    if (name.startsWith('__vidactSpread') && typeof value === 'function') {
      restoreAfterChildren = Boolean(value(element)) || restoreAfterChildren
      continue
    }
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
      // A generated renderable wrapper always projects a `ref` field, even when
      // its input does not own one. Do not let that nullish projection replace a
      // pending ref mounted by an earlier reactive spread. Authored overrides
      // are already excluded from that spread by `compiledSpread`.
      if (value !== null && value !== undefined) queueElementRef(element, value)
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
  if (child === null || child === undefined || typeof child === 'boolean') {
    claimHydrationText(parent, '')
    return
  }
  if (isStructuralBinding(child)) {
    child[1](parent, null)
    return
  }
  if (isCompiledBinding(child)) {
    mountCompiledBinding(parent, child)
    return
  }
  if (isRenderableProtocol(child)) {
    appendChild(parent, materializeRenderable(child) as DirectChild)
    return
  }
  if (Array.isArray(child)) {
    const hydratedRange = claimHydrationArrayRange(parent)
    for (const item of child) appendChild(parent, item)
    if (hydratedRange !== undefined) finishHydrationArrayRange(parent, hydratedRange[1])
    return
  }
  if (child instanceof Node) {
    if (child instanceof DocumentFragment) {
      const hydrationChildren = hydrationFragmentChildren(child)
      if (hydrationChildren !== undefined) {
        for (const item of hydrationChildren) appendChild(parent, item as DirectChild)
        return
      }
    }
    if (!claimHydrationNode(parent, child)) parent.appendChild(child)
    return
  }
  if (typeof child === 'object' || typeof child === 'function' || typeof child === 'symbol') {
    throw new TypeError(
      DEV ? 'unsupported direct child value; expected a DOM node or owned block' : 'V103',
    )
  }
  const content = String(child)
  if (claimHydrationText(parent, content) === undefined) {
    parent.appendChild(document.createTextNode(content))
  }
}
