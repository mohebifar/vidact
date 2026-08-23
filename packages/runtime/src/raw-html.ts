import {
  isCompiledBinding,
  mountCompiledPropTransition,
  type CompiledPropTransition,
} from './compiled.ts'
import { HydrationMismatch, isHydrating } from './hydration.ts'

const RAW_HTML_PUBLICATION_PRIORITY = 100
const rawHtmlHosts = new WeakSet<HTMLElement>()
const DEV = typeof __VIDACT_DEV__ === 'undefined' || __VIDACT_DEV__

export function mountRawHtmlProp(
  element: HTMLElement,
  value: unknown,
  children: readonly unknown[],
): void {
  if (value === null || value === undefined) return
  if (isCompiledBinding(value)) {
    mountCompiledPropTransition(
      value,
      (initial) => mountRawHtml(element, initial, children),
      (next, previous) => prepareRawHtml(element, next, previous, children),
    )
    return
  }
  mountRawHtml(element, value, children)
}

function mountRawHtml(element: HTMLElement, value: unknown, children: readonly unknown[]): void {
  const html = readRawHtml(element, value, children)
  if (html === null || html === undefined) return
  const container = rawHtmlContainer(element)
  const staged = parseRawHtml(element, html)
  if (isHydrating()) {
    if (!hasEqualHydrationRawChildren(container, staged)) {
      throw new HydrationMismatch('server raw HTML does not match the client value')
    }
  } else {
    container.replaceChildren(adoptRawHtml(element, staged))
  }
  rawHtmlHosts.add(element)
}

function hasEqualHydrationRawChildren(container: Node, expected: DocumentFragment): boolean {
  const start = container.firstChild
  const end = container.lastChild
  if (
    !(start instanceof Comment) ||
    start.data !== 'vidact:v1:h' ||
    !(end instanceof Comment) ||
    end.data !== '/vidact:v1:h'
  ) {
    return false
  }
  const actual: Node[] = []
  for (let node = start.nextSibling; node !== null && node !== end; node = node.nextSibling) {
    actual.push(node)
  }
  if (actual.length !== expected.childNodes.length) return false
  for (let index = 0; index < actual.length; index += 1) {
    if (!actual[index]?.isEqualNode(expected.childNodes[index] ?? null)) return false
  }
  return true
}

function prepareRawHtml(
  element: HTMLElement,
  nextValue: unknown,
  previousValue: unknown,
  children: readonly unknown[],
): CompiledPropTransition | undefined {
  const nextHtml = readRawHtml(element, nextValue, children)
  const previousHtml = readRawHtml(element, previousValue, children)
  if (nextHtml === null || nextHtml === undefined || nextHtml === previousHtml) return undefined

  const staged = parseRawHtml(element, nextHtml)
  const container = rawHtmlContainer(element)
  const wasRawHtmlHost = rawHtmlHosts.has(element)
  let previousNodes: Node[] | undefined
  return [
    () => {
      // A reactive script `type` prop commits before the raw subtree.
      assertExecutableRawHtmlTarget(element)
      const adopted = adoptRawHtml(element, staged)
      previousNodes = [...container.childNodes]
      container.replaceChildren(adopted)
      rawHtmlHosts.add(element)
    },
    () => {
      if (previousNodes === undefined) return
      container.replaceChildren(...previousNodes)
      if (!wasRawHtmlHost) rawHtmlHosts.delete(element)
      previousNodes = undefined
    },
    undefined,
    undefined,
    RAW_HTML_PUBLICATION_PRIORITY,
  ]
}

export function validateRawHtmlRelatedProp(element: HTMLElement, name: string): void {
  if (name === 'type' && rawHtmlHosts.has(element)) assertExecutableRawHtmlTarget(element)
}

function readRawHtml(element: HTMLElement, value: unknown, children: readonly unknown[]): unknown {
  if (value === null || value === undefined) return undefined
  assertRawHtmlPropTarget(element)
  if (typeof value !== 'object' || !('__html' in value)) {
    throw new Error(
      DEV
        ? '`props.dangerouslySetInnerHTML` must be in the form `{__html: ...}`. Please visit https://react.dev/link/dangerously-set-inner-html for more information.'
        : 'V601',
    )
  }
  const html = value['__html']
  if (html === null || html === undefined) return html
  if (children.some((child) => child !== null && child !== undefined)) {
    throw new Error(
      DEV ? 'Can only set one of `children` or `props.dangerouslySetInnerHTML`.' : 'V602',
    )
  }
  assertExecutableRawHtmlTarget(element)
  return html
}

function assertRawHtmlPropTarget(element: HTMLElement): void {
  const tag = element.localName
  if (isVoidHtmlElement(tag)) {
    throw new Error(
      DEV
        ? `${tag} is a void element tag and must neither have \`children\` nor use \`dangerouslySetInnerHTML\`.`
        : 'V603',
    )
  }
  if (tag === 'textarea') {
    throw new Error(DEV ? '`dangerouslySetInnerHTML` does not make sense on <textarea>.' : 'V604')
  }
}

function assertExecutableRawHtmlTarget(element: HTMLElement): void {
  const tag = element.localName
  if (tag === 'script' && isExecutableScript(element as HTMLScriptElement)) {
    throw new Error(
      DEV
        ? 'dangerouslySetInnerHTML on an executable <script> is unsupported because direct-created scripts execute when connected; use a non-executable data MIME type'
        : 'V605',
    )
  }
}

function isVoidHtmlElement(tag: string): boolean {
  return (
    tag === 'area' ||
    tag === 'base' ||
    tag === 'br' ||
    tag === 'col' ||
    tag === 'embed' ||
    tag === 'hr' ||
    tag === 'img' ||
    tag === 'input' ||
    tag === 'keygen' ||
    tag === 'link' ||
    tag === 'menuitem' ||
    tag === 'meta' ||
    tag === 'param' ||
    tag === 'source' ||
    tag === 'track' ||
    tag === 'wbr'
  )
}

function isExecutableScript(element: HTMLScriptElement): boolean {
  const type = element.type.trim().toLowerCase().split(';', 1)[0] ?? ''
  if (type === '' || type === 'module' || type === 'importmap' || type === 'speculationrules') {
    return true
  }
  return (
    /^(?:application|text)\/(?:x-)?(?:java|ecma)script(?:1\.[0-5])?$/.test(type) ||
    type === 'text/jscript' ||
    type === 'text/livescript'
  )
}

function parseRawHtml(element: HTMLElement, html: unknown): DocumentFragment {
  const stagingDocument = element.ownerDocument.implementation.createHTMLDocument()
  const staging =
    element.localName === 'noscript'
      ? (element.cloneNode(false) as HTMLElement)
      : stagingDocument.createElement(element.localName.includes('-') ? 'div' : element.localName)
  Reflect.set(staging, 'innerHTML', html)
  const fragment = staging.ownerDocument.createDocumentFragment()
  fragment.append(...rawHtmlContainer(staging).childNodes)
  return fragment
}

function rawHtmlContainer(element: HTMLElement): HTMLElement | DocumentFragment {
  return element instanceof HTMLTemplateElement ? element.content : element
}

function adoptRawHtml(element: HTMLElement, staged: DocumentFragment): DocumentFragment {
  if (staged.ownerDocument === element.ownerDocument) return staged
  const adopted = element.ownerDocument.createDocumentFragment()
  adopted.append(...staged.childNodes)
  element.ownerDocument.defaultView?.customElements.upgrade(adopted)
  return adopted
}
