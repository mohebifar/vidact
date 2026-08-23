import { registerCompiledCleanup } from './compiled.ts'
import { applyBaseDomProp, installDomPropHandler } from './dom/properties.ts'

type MetadataEntry = {
  readonly elements: Element[]
  readonly baseline: number
}

type MetadataState = {
  readonly entries: Map<string, MetadataEntry>
  readonly stylePrecedence: string[]
}

type MetadataOwner = {
  readonly element: Element
  readonly state: MetadataState
  entry: MetadataEntry
  key: string
}

const metadataByDocument = new WeakMap<Document, MetadataState>()
const metadataOwners = new WeakMap<Element, MetadataOwner>()
let propRekeyingInstalled = false

export function installFrameworkMetadataPropRekeying(): void {
  if (propRekeyingInstalled) return
  propRekeyingInstalled = true
  installDomPropHandler((element, name, value) => {
    const owner = metadataOwners.get(element)
    if (owner === undefined || !isMetadataIdentityProp(element.localName, name)) return false
    detachMetadataOwner(owner)
    applyBaseDomProp(element, name, value)
    if (name === 'precedence') {
      element.setAttribute('data-precedence', String(value ?? 'default'))
      element.removeAttribute('precedence')
    }
    attachMetadataOwner(owner)
    return true
  })
}

export function isFrameworkMetadataElement(
  element: Element,
  props: Readonly<Record<string, unknown>> | null = null,
): boolean {
  const name = element.localName
  if (
    (name === 'title' || name === 'meta' || name === 'link') &&
    element.hasAttribute('itemprop')
  ) {
    return false
  }
  if (name === 'title' || name === 'meta') return true
  if (name === 'link') {
    if (
      props !== null &&
      ['onLoad', 'onError', 'disabled'].some((key) => Object.hasOwn(props, key))
    ) {
      return false
    }
    return element.getAttribute('rel') !== 'stylesheet' || element.hasAttribute('precedence')
  }
  if (name === 'style') return element.hasAttribute('href') && element.hasAttribute('precedence')
  return name === 'script' && element.hasAttribute('async') && element.hasAttribute('src')
}

export function hoistFrameworkMetadata(element: Element): DocumentFragment {
  const document = element.ownerDocument
  const state = metadataState(document)
  const key = metadataKey(element)
  const owner: MetadataOwner = {
    element,
    state,
    key,
    entry: metadataEntry(document, state, key),
  }
  attachMetadataOwner(owner)
  metadataOwners.set(element, owner)
  element.removeAttribute('precedence')
  registerCompiledCleanup(() => {
    detachMetadataOwner(owner)
    metadataOwners.delete(element)
  })
  return document.createDocumentFragment()
}

function metadataState(document: Document): MetadataState {
  let state = metadataByDocument.get(document)
  if (state !== undefined) return state
  state = {
    entries: new Map(),
    stylePrecedence: [...document.head.children]
      .filter((candidate) => metadataTier(candidate) === 2)
      .map(stylePrecedence)
      .filter((value, index, values) => values.indexOf(value) === index),
  }
  metadataByDocument.set(document, state)
  return state
}

function metadataEntry(document: Document, state: MetadataState, key: string): MetadataEntry {
  let entry = state.entries.get(key)
  if (entry !== undefined) return entry
  const existing = [...document.head.children].find(
    (candidate) => isFrameworkMetadataElement(candidate) && metadataKey(candidate) === key,
  )
  entry = {
    elements: existing === undefined ? [] : [existing],
    baseline: existing === undefined ? 0 : 1,
  }
  state.entries.set(key, entry)
  return entry
}

function attachMetadataOwner(owner: MetadataOwner): void {
  const document = owner.element.ownerDocument
  owner.key = metadataKey(owner.element)
  owner.entry = metadataEntry(document, owner.state, owner.key)
  owner.entry.elements.at(-1)?.remove()
  owner.entry.elements.push(owner.element)
  insertByPrecedence(document.head, owner.element, owner.state)
}

function detachMetadataOwner(owner: MetadataOwner): void {
  const { element, entry, key, state } = owner
  const index = entry.elements.indexOf(element)
  if (index === -1) return
  const visible = index === entry.elements.length - 1
  entry.elements.splice(index, 1)
  element.remove()
  if (entry.elements.length === entry.baseline) {
    if (visible && entry.elements.length !== 0) {
      element.ownerDocument.head.append(entry.elements.at(-1)!)
    }
    if (state.entries.get(key) === entry) state.entries.delete(key)
  } else if (visible) {
    insertByPrecedence(element.ownerDocument.head, entry.elements.at(-1)!, state)
  }
}

function isMetadataIdentityProp(elementName: string, propName: string): boolean {
  if (propName === 'precedence') return elementName === 'link' || elementName === 'style'
  if (elementName === 'meta') {
    return ['charSet', 'name', 'property', 'httpEquiv'].includes(propName)
  }
  if (elementName === 'link') return ['rel', 'href', 'as'].includes(propName)
  if (elementName === 'script') return propName === 'src'
  return false
}

function metadataKey(element: Element): string {
  const name = element.localName
  if (name === 'title') return 'title'
  if (name === 'meta') {
    for (const attribute of ['charset', 'name', 'property', 'http-equiv']) {
      if (element.hasAttribute(attribute))
        return `meta:${attribute}:${element.getAttribute(attribute)}`
    }
  }
  if (name === 'link') {
    return `link:${element.getAttribute('rel') ?? ''}:${element.getAttribute('href') ?? ''}:${element.getAttribute('as') ?? ''}`
  }
  if (name === 'style') return `style:${element.getAttribute('href') ?? ''}`
  return `script:${element.getAttribute('src') ?? ''}`
}

function insertByPrecedence(head: HTMLHeadElement, element: Element, state: MetadataState): void {
  const tier = metadataTier(element) ?? 1
  const precedence = stylePrecedence(element)
  if (tier === 2) {
    if (!state.stylePrecedence.includes(precedence)) state.stylePrecedence.push(precedence)
    element.setAttribute('data-precedence', precedence)
  }
  const before = [...head.children].find((candidate) => {
    const candidateTier = metadataTier(candidate)
    if (candidateTier === undefined) return false
    if (candidateTier !== tier) return candidateTier > tier
    return (
      tier === 2 &&
      state.stylePrecedence.indexOf(stylePrecedence(candidate)) >
        state.stylePrecedence.indexOf(precedence)
    )
  })
  head.insertBefore(element, before ?? null)
}

function metadataTier(element: Element): number | undefined {
  const name = element.localName
  if (name === 'style') return element.hasAttribute('data-precedence') ? 2 : undefined
  if (name === 'script') return element.hasAttribute('src') ? 3 : undefined
  if (name === 'link') {
    const relation = element.getAttribute('rel')
    if (relation === 'stylesheet') {
      return element.hasAttribute('precedence') || element.hasAttribute('data-precedence')
        ? 2
        : undefined
    }
    if (['preconnect', 'dns-prefetch', 'preload', 'modulepreload'].includes(relation ?? ''))
      return 0
    return 1
  }
  return name === 'title' || name === 'meta' ? 1 : undefined
}

function stylePrecedence(element: Element): string {
  return element.getAttribute('precedence') ?? element.getAttribute('data-precedence') ?? 'default'
}
