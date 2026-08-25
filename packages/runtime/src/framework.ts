import type { CompiledComponentResult } from './compiled/types.ts'
import { installFrameworkMetadata } from './direct-dom.ts'
import type { FrameworkValue } from './framework-protocol.ts'
import {
  hoistFrameworkMetadata,
  installFrameworkMetadataPropRekeying,
  isFrameworkMetadataElement,
} from './metadata.ts'

let metadataInstalled = false
const CLIENT_BOUNDARY_DEFINITION = Symbol('Vidact.ClientBoundaryDefinition')

export interface ClientBoundaryDefinition<Props = FrameworkValue, Prepared = unknown> {
  readonly [CLIENT_BOUNDARY_DEFINITION]: true
  readonly prepare?: (props: Props) => Prepared | PromiseLike<Prepared>
  readonly render: (props: Props, prepared: Prepared) => CompiledComponentResult
}

export function defineClientBoundary<Props = FrameworkValue, Prepared = void>(
  render: (props: Props, prepared: Prepared) => CompiledComponentResult,
  prepare?: (props: Props) => Prepared | PromiseLike<Prepared>,
): ClientBoundaryDefinition<Props, Prepared> {
  return Object.freeze({
    [CLIENT_BOUNDARY_DEFINITION]: true as const,
    render,
    ...(prepare === undefined ? {} : { prepare }),
  })
}

export function isClientBoundaryDefinition(value: unknown): value is ClientBoundaryDefinition {
  return (
    typeof value === 'object' &&
    value !== null &&
    CLIENT_BOUNDARY_DEFINITION in value &&
    typeof Reflect.get(value, 'render') === 'function'
  )
}

/** @internal */
export function enableFrameworkMetadata(): void {
  if (metadataInstalled) return
  metadataInstalled = true
  installFrameworkMetadataPropRekeying()
  installFrameworkMetadata((element, props) =>
    isFrameworkMetadataElement(element, props) ? hoistFrameworkMetadata(element) : element,
  )
}

export interface ResourceHintOptions {
  readonly crossOrigin?: '' | 'anonymous' | 'use-credentials'
}

export interface PreloadOptions extends ResourceHintOptions {
  readonly as: string
  readonly fetchPriority?: 'high' | 'low' | 'auto'
  readonly imageSizes?: string
  readonly imageSrcSet?: string
  readonly integrity?: string
  readonly nonce?: string
  readonly referrerPolicy?: string
  readonly type?: string
}

export interface PreinitOptions extends ResourceHintOptions {
  readonly as: 'script' | 'style'
  readonly precedence?: string
  readonly integrity?: string
  readonly nonce?: string
}

export function preconnect(href: string, options: ResourceHintOptions = {}): void {
  appendLink('preconnect', href, options)
}

export function prefetchDNS(href: string): void {
  appendLink('dns-prefetch', href, {})
}

export function preload(href: string, options: PreloadOptions): void {
  appendLink('preload', href, options)
}

export function preloadModule(href: string, options: ResourceHintOptions = {}): void {
  appendLink('modulepreload', href, options)
}

export function preinit(href: string, options: PreinitOptions): void {
  assertHref(href)
  if (options.as === 'style') {
    if (document.head.querySelector(`link[rel="stylesheet"][href="${CSS.escape(href)}"]`)) return
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    if (options.precedence !== undefined) link.dataset.precedence = options.precedence
    applyResourceOptions(link, options)
    document.head.append(link)
    return
  }
  if (document.head.querySelector(`script[src="${CSS.escape(href)}"]`)) return
  const script = document.createElement('script')
  script.src = href
  applyResourceOptions(script, options)
  document.head.append(script)
}

export function preinitModule(href: string, options: ResourceHintOptions = {}): void {
  assertHref(href)
  if (document.head.querySelector(`script[type="module"][src="${CSS.escape(href)}"]`)) return
  const script = document.createElement('script')
  script.type = 'module'
  script.src = href
  applyResourceOptions(script, options)
  document.head.append(script)
}

function appendLink(
  relation: string,
  href: string,
  options: ResourceHintOptions | PreloadOptions,
): void {
  assertHref(href)
  const as = 'as' in options ? options.as : undefined
  const selector = `link[rel="${CSS.escape(relation)}"][href="${CSS.escape(href)}"]${as === undefined ? '' : `[as="${CSS.escape(as)}"]`}`
  if (document.head.querySelector(selector)) return
  const link = document.createElement('link')
  link.rel = relation
  link.href = href
  if (as !== undefined) link.as = as
  applyResourceOptions(link, options)
  document.head.append(link)
}

function applyResourceOptions(
  element: HTMLLinkElement | HTMLScriptElement,
  options: ResourceHintOptions | PreloadOptions | PreinitOptions,
): void {
  if (options.crossOrigin !== undefined) element.crossOrigin = options.crossOrigin
  if ('integrity' in options && options.integrity !== undefined)
    element.integrity = options.integrity
  if ('nonce' in options && options.nonce !== undefined) element.nonce = options.nonce
  if (element instanceof HTMLLinkElement) {
    if ('fetchPriority' in options && options.fetchPriority !== undefined) {
      element.fetchPriority = options.fetchPriority
    }
    if ('imageSizes' in options && options.imageSizes !== undefined) {
      element.imageSizes = options.imageSizes
    }
    if ('imageSrcSet' in options && options.imageSrcSet !== undefined) {
      element.imageSrcset = options.imageSrcSet
    }
    if ('referrerPolicy' in options && options.referrerPolicy !== undefined) {
      element.referrerPolicy = options.referrerPolicy
    }
    if ('type' in options && options.type !== undefined) element.type = options.type
  }
}

function assertHref(href: string): void {
  if (typeof href !== 'string' || href.length === 0)
    throw new TypeError('resource href must be non-empty')
}
