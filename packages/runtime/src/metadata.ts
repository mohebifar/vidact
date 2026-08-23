import { registerCompiledCleanup } from './compiled.ts'

type MetadataEntry = {
  readonly elements: Element[]
  readonly baseline: number
}

const entriesByDocument = new WeakMap<Document, Map<string, MetadataEntry>>()

export function isFrameworkMetadataElement(element: Element): boolean {
  const name = element.localName
  if (name === 'title' || name === 'meta' || name === 'link') return true
  if (name === 'style') return element.hasAttribute('precedence')
  return name === 'script' && element.hasAttribute('async') && element.hasAttribute('src')
}

export function hoistFrameworkMetadata(element: Element): DocumentFragment {
  const document = element.ownerDocument
  let entries = entriesByDocument.get(document)
  if (entries === undefined) {
    entries = new Map()
    entriesByDocument.set(document, entries)
  }
  const key = metadataKey(element)
  let entry = entries.get(key)
  if (entry === undefined) {
    const existing = [...document.head.children].find(
      (candidate) => isFrameworkMetadataElement(candidate) && metadataKey(candidate) === key,
    )
    entry = {
      elements: existing === undefined ? [] : [existing],
      baseline: existing === undefined ? 0 : 1,
    }
    entries.set(key, entry)
  }
  entry.elements.at(-1)?.remove()
  entry.elements.push(element)
  insertByPrecedence(document.head, element)
  element.removeAttribute('precedence')
  registerCompiledCleanup(() => {
    if (entry === undefined) return
    const index = entry.elements.indexOf(element)
    if (index === -1) return
    const visible = index === entry.elements.length - 1
    entry.elements.splice(index, 1)
    element.remove()
    if (entry.elements.length === entry.baseline) {
      if (visible && entry.elements.length !== 0) {
        document.head.append(entry.elements.at(-1)!)
      }
      if (entries?.get(key) === entry) entries.delete(key)
    } else if (visible) {
      insertByPrecedence(document.head, entry.elements.at(-1)!)
    }
  })
  return document.createDocumentFragment()
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
  if (name === 'style') return `style:${element.getAttribute('href') ?? element.textContent ?? ''}`
  return `script:${element.getAttribute('src') ?? ''}`
}

function insertByPrecedence(head: HTMLHeadElement, element: Element): void {
  const precedence =
    element.getAttribute('precedence') ??
    element.getAttribute('data-precedence') ??
    metadataPrecedence(element)
  element.setAttribute('data-precedence', precedence)
  const before = [...head.querySelectorAll('[data-precedence]')].find(
    (candidate) => (candidate.getAttribute('data-precedence') ?? '').localeCompare(precedence) > 0,
  )
  head.insertBefore(element, before ?? null)
}

function metadataPrecedence(element: Element): string {
  if (element.localName === 'style' || element.getAttribute('rel') === 'stylesheet') {
    return '2:default'
  }
  return element.localName === 'script' ? '3:script' : '1:metadata'
}
