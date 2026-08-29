// oxlint-disable-next-line typescript/triple-slash-reference -- Include compiler feature defines.
/// <reference path="./env.d.ts" />

import type { JSX as ReactJSX } from 'react'

import {
  LINK_IDENTITY_PROPS,
  META_IDENTITY_PROPS,
  SERVER_BOOLEAN_ATTRIBUTES,
  VALID_ATTRIBUTE_NAME,
  serverHtmlAttributeName,
} from './dom/attributes.ts'
import { UNITLESS_STYLE_PROPERTIES } from './dom/style-properties.ts'
import type { PreinitOptions, PreloadOptions, ResourceHintOptions } from './framework.ts'
import { isPromiseLike } from './shared/promise.ts'

const SERVER_NODE = Symbol.for('vidact.v1.ServerNode')
const SERVER_NODE_KIND = Symbol.for('vidact.v1.ServerNodeKind')
const SERVER_CONTEXT = Symbol('Vidact.ServerContext')
const SERVER_ASYNC_RESOURCE = Symbol('Vidact.ServerAsyncResource')
const SERVER_SUSPENSION = Symbol('Vidact.ServerSuspension')
const SERVER_RENDERABLE = Symbol.for('vidact.v1.ServerRenderable')

export interface ServerNode {
  readonly [SERVER_NODE]: (context: RenderContext) => string
  readonly [SERVER_NODE_KIND]: 'component' | 'intrinsic' | 'transparent'
}

export type ServerChild =
  | ServerNode
  | ServerRenderable
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined
  | readonly ServerChild[]

export type ServerComponent = (props: Record<string, unknown>) => ServerChild
export type ServerElementType = string | typeof Fragment | ServerComponent | ServerRenderable
export type ServerProps = Record<string, unknown> | null

type ServerRenderable = {
  readonly props: Record<string, unknown>
  readonly [SERVER_RENDERABLE]: {
    readonly input: Record<string, unknown>
    readonly construct: (input: Record<string, unknown>) => ServerChild
  }
}

type ServerIntrinsicElements = {
  [Name in keyof ReactJSX.IntrinsicElements]: Omit<ReactJSX.IntrinsicElements[Name], 'children'> & {
    readonly children?: ServerChild
  }
}

export namespace JSX {
  export type Element = ServerNode
  export type ElementType = keyof IntrinsicElements | ServerComponent | ServerRenderable

  export interface ElementChildrenAttribute extends ReactJSX.ElementChildrenAttribute {}

  export interface IntrinsicAttributes extends ReactJSX.IntrinsicAttributes {}

  export type IntrinsicElements = ServerIntrinsicElements
}

export function createRenderable(
  input: Record<string, unknown>,
  construct: (input: Record<string, unknown>) => ServerChild,
): ServerRenderable {
  return {
    props: input,
    [SERVER_RENDERABLE]: { input, construct },
  }
}

export function isRenderable(value: unknown): value is ServerRenderable {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.hasOwn(value, SERVER_RENDERABLE) &&
    typeof (value as ServerRenderable)[SERVER_RENDERABLE]?.construct === 'function'
  )
}

export function renderableToArray(value: unknown): [ServerRenderable] {
  if (!isRenderable(value)) throw new TypeError('expected a compiled server renderable')
  return [value]
}

export function renderableMarker(value: unknown): undefined {
  if (!isRenderable(value)) throw new TypeError('expected a compiled server renderable')
  return undefined
}

export function cloneRenderable(
  value: unknown,
  overrides: Record<string, unknown> | null = {},
  childrenOverride?: ServerChild,
): ServerChild {
  if (!isRenderable(value)) throw new TypeError('expected a compiled server renderable')
  const renderable = value[SERVER_RENDERABLE]
  const input = { ...renderable.input, ...overrides }
  if (arguments.length >= 3) input.children = childrenOverride
  return renderable.construct(input)
}

export function cloneRenderableComponent(props: Record<string, unknown>): ServerChild {
  if (Object.hasOwn(props, 'childrenOverride')) {
    return cloneRenderable(
      props.value,
      props.overrides as Record<string, unknown> | null | undefined,
      props.childrenOverride as ServerChild,
    )
  }
  return cloneRenderable(props.value, props.overrides as Record<string, unknown> | null | undefined)
}

export function keyedFragmentComponent(props: Record<string, unknown>): ServerChild {
  return props.children as ServerChild
}

export function renderableProps(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([name]) => !['children', 'key', 'ref'].includes(name)),
  )
}

export function renderableChildren(input: Record<string, unknown>): ServerChild {
  return input.children as ServerChild
}

export function renderableRef(_input: Record<string, unknown>): undefined {
  return undefined
}

export function forwardedRef(_props: Record<string, unknown>): undefined {
  return undefined
}

export function dynamicIntrinsicComponent(props: Record<string, unknown>): ServerNode {
  if (typeof props.tag !== 'string') {
    throw new TypeError('dynamic intrinsic construction requires a string tag')
  }
  const input = { ...(props.props as Record<string, unknown>) }
  if (Object.hasOwn(props, 'childrenOverride')) input.children = props.childrenOverride
  return jsx(props.tag, {
    ...renderableProps(input),
    children: renderableChildren(input),
  })
}

export interface ServerRenderOptions {
  readonly identifierPrefix?: string
}

type FrameworkCacheEntry = {
  readonly args: readonly unknown[]
  readonly status: 'fulfilled' | 'rejected'
  readonly value: unknown
}

/** @internal */
export interface ServerFrameworkRenderContext {
  readonly signal: AbortSignal
  readonly pending: Set<PromiseLike<unknown>>
  readonly cache: Map<Function, FrameworkCacheEntry[]>
  readonly head: Map<string, { readonly html: string; readonly precedence: string }>
  readonly stylePrecedence: string[]
  sawHead: boolean
}

interface RenderContext {
  hydrationMarkers: boolean
  identifierPrefix: string
  nextBoundary: number
  nextId: number
  activityHidden: boolean
}

interface ContextState<Value> {
  readonly defaultValue: Value
  readonly stack: Value[]
}

export interface ServerContext<Value> {
  readonly Provider: ServerComponent
  readonly [SERVER_CONTEXT]: ContextState<Value>
}

type ServerAsyncState<Value> =
  | { readonly status: 'pending' }
  | { readonly status: 'fulfilled'; readonly value: Value }
  | { readonly status: 'rejected'; readonly reason: unknown }

export interface ServerAsyncResource<Value> {
  readonly [SERVER_ASYNC_RESOURCE]: ServerAsyncState<Value>
  readonly promise: PromiseLike<Value>
}

type ServerSuspension = {
  readonly [SERVER_SUSPENSION]: true
  readonly resource: ServerAsyncResource<unknown>
}

export type ServerLazyModule<Props extends Record<string, unknown>> = {
  readonly default: (props: Props) => ServerChild
}

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'keygen',
  'link',
  'menuitem',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])

const HYDRATION_PREFIX = 'vidact:v1'
const UNSAFE_HTML = typeof __VIDACT_UNSAFE_HTML__ !== 'undefined' && __VIDACT_UNSAFE_HTML__

let activeRender: RenderContext | undefined
let activeFrameworkRender: ServerFrameworkRenderContext | undefined
const serverBuiltins = new WeakSet<ServerComponent>()
serverBuiltins.add(dynamicIntrinsicComponent)
serverBuiltins.add(cloneRenderableComponent)
serverBuiltins.add(keyedFragmentComponent)
const serverPromiseResources = new WeakMap<object, ServerAsyncResource<unknown>>()

const FRAMEWORK_HEAD_PLACEHOLDER = '<!--vidact-framework:v1:head-->'

export const Fragment = Symbol('Vidact.ServerFragment')

/** @internal */
export function createServerFrameworkRenderContext(
  signal: AbortSignal,
): ServerFrameworkRenderContext {
  return {
    signal,
    pending: new Set(),
    cache: new Map(),
    head: new Map(),
    stylePrecedence: [],
    sawHead: false,
  }
}

/** @internal */
export function withServerFrameworkRenderContext<Result>(
  context: ServerFrameworkRenderContext,
  operation: () => Result,
): Result {
  const previous = activeFrameworkRender
  activeFrameworkRender = context
  try {
    return operation()
  } finally {
    activeFrameworkRender = previous
  }
}

export function cache<Arguments extends readonly unknown[], Result>(
  operation: (...arguments_: Arguments) => Result,
): (...arguments_: Arguments) => Result {
  return (...arguments_) => {
    const context = activeFrameworkRender
    if (context === undefined) return operation(...arguments_)
    let entries = context.cache.get(operation)
    if (entries === undefined) {
      entries = []
      context.cache.set(operation, entries)
    }
    const existing = entries.find(
      (entry) =>
        entry.args.length === arguments_.length &&
        entry.args.every((argument, index) => Object.is(argument, arguments_[index])),
    )
    if (existing !== undefined) {
      if (existing.status === 'rejected') throw existing.value
      return existing.value as Result
    }
    try {
      const value = operation(...arguments_)
      entries.push({ args: [...arguments_], status: 'fulfilled', value })
      return value
    } catch (error) {
      entries.push({ args: [...arguments_], status: 'rejected', value: error })
      throw error
    }
  }
}

export function cacheSignal(): AbortSignal | null {
  return activeFrameworkRender?.signal ?? null
}

export function preconnect(href: string, options: ResourceHintOptions = {}): void {
  registerResourceHint('preconnect', href, options)
}

export function prefetchDNS(href: string): void {
  registerResourceHint('dns-prefetch', href, {})
}

export function preload(href: string, options: PreloadOptions): void {
  registerResourceHint('preload', href, options)
}

export function preloadModule(href: string, options: ResourceHintOptions = {}): void {
  registerResourceHint('modulepreload', href, options)
}

export function preinit(href: string, options: PreinitOptions): void {
  if (options.as === 'style') {
    registerHeadEntry(
      `style:${href}`,
      `<link rel="stylesheet" href="${escapeAttribute(href)}"${serializeHintOptions(options)}>`,
      `2:${options.precedence ?? 'default'}`,
    )
    return
  }
  registerHeadEntry(
    `script:${href}`,
    `<script src="${escapeAttribute(href)}"${serializeHintOptions(options)}></script>`,
    '3:script',
  )
}

export function preinitModule(href: string, options: ResourceHintOptions = {}): void {
  registerHeadEntry(
    `module:${href}`,
    `<script type="module" src="${escapeAttribute(href)}"${serializeHintOptions(options)}></script>`,
    '3:script',
  )
}

export function jsx(type: ServerElementType, props: ServerProps, _key?: unknown): ServerNode {
  return createServerElement(type, props, false)
}

export function jsxs(type: ServerElementType, props: ServerProps, _key?: unknown): ServerNode {
  return createServerElement(type, props, true)
}

export function jsxDEV(
  type: ServerElementType,
  props: ServerProps,
  _key?: unknown,
  isStaticChildren = false,
): ServerNode {
  return createServerElement(type, props, isStaticChildren)
}

export function createElement(
  type: ServerElementType,
  props: ServerProps,
  ...children: ServerChild[]
): ServerNode {
  const nextProps: Record<string, unknown> = { ...props }
  if (children.length === 1) nextProps.children = children[0]
  else if (children.length > 1) nextProps.children = children
  return createServerElement(type, nextProps, children.length > 1)
}

/** @internal */
export function createServerHydrationBoundary(
  value: ServerChild,
  hostProps: Readonly<Record<string, unknown>> = {},
): ServerNode {
  return serverNode((context) => {
    const boundaryIndex = context.nextBoundary
    context.nextBoundary += 1
    const identifierPrefix = `${context.identifierPrefix}b${boundaryIndex}-`
    const boundaryContext: RenderContext = {
      hydrationMarkers: true,
      identifierPrefix,
      nextBoundary: 0,
      nextId: 0,
      activityHidden: false,
    }
    const attributes = serializeAttributes(
      {
        ...hostProps,
        'data-vidact-identifier-prefix': identifierPrefix,
      },
      context.activityHidden,
    )
    return `<div${attributes}>${hydrationRange('r', serializeSlot(value, boundaryContext))}</div>`
  }, 'transparent')
}

function createServerElement(
  type: ServerElementType,
  props: ServerProps,
  multipleChildren: boolean,
): ServerNode {
  if (type === Fragment) {
    return serverNode(
      (context) =>
        Object.hasOwn(props ?? {}, 'children')
          ? multipleChildren
            ? serializeChildren(props?.children as ServerChild, context, true)
            : serializeSlot(props?.children as ServerChild, context)
          : '',
      'transparent',
    )
  }
  if (isRenderable(type)) {
    return serverNode(
      (context) => serializeSlot(cloneRenderable(type, props ?? {}), context),
      'component',
    )
  }
  if (typeof type === 'function') {
    const builtin = serverBuiltins.has(type)
    return serverNode(
      (context) => {
        const content = serializeSlot(type(props ?? {}) as ServerChild, context)
        return context.hydrationMarkers && !builtin ? hydrationRange('c', content) : content
      },
      builtin ? 'transparent' : 'component',
    )
  }

  if (!VALID_ATTRIBUTE_NAME.test(type)) throw new TypeError(`invalid server element name ${type}`)
  return serverNode(
    (context) => serializeIntrinsicElement(type, props, multipleChildren, context),
    'intrinsic',
  )
}

function serializeIntrinsicElement(
  type: string,
  props: ServerProps,
  multipleChildren: boolean,
  context: RenderContext,
): string {
  if (activeFrameworkRender !== undefined && isHoistableHeadElement(type, props)) {
    const hydrationMarkers = context.hydrationMarkers
    context.hydrationMarkers = false
    try {
      const html = serializeIntrinsicContents(type, props, multipleChildren, context)
      registerHeadEntry(metadataKey(type, props), html, metadataPrecedence(type, props))
      return ''
    } finally {
      context.hydrationMarkers = hydrationMarkers
    }
  }
  return serializeIntrinsicContents(type, props, multipleChildren, context)
}

function serializeIntrinsicContents(
  type: string,
  props: ServerProps,
  multipleChildren: boolean,
  context: RenderContext,
): string {
  const hiddenByActivity = context.activityHidden
  const previousActivityHidden = context.activityHidden
  context.activityHidden = false
  try {
    const attributes = serializeAttributes(props, hiddenByActivity)
    if (VOID_ELEMENTS.has(type)) {
      if (hasRenderableChild(props?.children as ServerChild) || readRawHtml(props) !== undefined) {
        throw new TypeError(`${type} is a void element and cannot have children or raw HTML`)
      }
      return `<${type}${attributes}>`
    }

    const rawHtml = readRawHtml(props)
    if (rawHtml !== undefined && hasRenderableChild(props?.children as ServerChild)) {
      throw new TypeError('cannot set both children and dangerouslySetInnerHTML')
    }
    const hasChildren = Object.hasOwn(props ?? {}, 'children')
    const children =
      rawHtml === undefined
        ? hasChildren
          ? multipleChildren
            ? serializeChildren(props?.children as ServerChild, context, !isRawTextElement(type))
            : serializeSlot(props?.children as ServerChild, context, !isRawTextElement(type))
          : ''
        : context.hydrationMarkers
          ? hydrationRange('h', assertSafeHydrationRawHtml(rawHtml))
          : rawHtml
    if (type === 'head' && activeFrameworkRender !== undefined) {
      activeFrameworkRender.sawHead = true
      return `<head${attributes}>${children}${FRAMEWORK_HEAD_PLACEHOLDER}</head>`
    }
    return `<${type}${attributes}>${children}</${type}>`
  } finally {
    context.activityHidden = previousActivityHidden
  }
}

export function renderToString(
  value: ServerChild | (() => ServerChild),
  options: ServerRenderOptions = {},
): string {
  const previous = activeRender
  beginFrameworkRenderPass()
  const context = {
    hydrationMarkers: true,
    identifierPrefix: options.identifierPrefix ?? '',
    nextBoundary: 0,
    nextId: 0,
    activityHidden: false,
  }
  activeRender = context
  try {
    const html = hydrationRange(
      'r',
      serializeSlot(typeof value === 'function' ? value() : value, context),
    )
    return finalizeFrameworkHtml(html)
  } finally {
    activeRender = previous
  }
}

export function renderToStaticMarkup(
  value: ServerChild | (() => ServerChild),
  options: ServerRenderOptions = {},
): string {
  const previous = activeRender
  beginFrameworkRenderPass()
  const context = {
    hydrationMarkers: false,
    identifierPrefix: options.identifierPrefix ?? '',
    nextBoundary: 0,
    nextId: 0,
    activityHidden: false,
  }
  activeRender = context
  try {
    return finalizeFrameworkHtml(
      serializeChild(typeof value === 'function' ? value() : value, context),
    )
  } finally {
    activeRender = previous
  }
}

export type StateUpdate<Value> = Value | ((previous: Value) => Value)

export function useState<Value>(
  initial: Value | (() => Value),
): [Value, (value: StateUpdate<Value>) => void] {
  const value = typeof initial === 'function' ? (initial as () => Value)() : initial
  return [value, serverDispatch]
}

export function useReducer<State, Action>(
  _reducer: (state: State, action: Action) => State,
  initial: State,
  initialize?: (value: State) => State,
): [State, (action: Action) => void] {
  return [initialize === undefined ? initial : initialize(initial), serverDispatch]
}

export function startTransition(action: () => void | PromiseLike<void>): void {
  void action()
}

export function useTransition(): [boolean, typeof startTransition] {
  return [false, startTransition]
}

export function useDeferredValue<Value>(value: Value, _initialValue?: Value): Value {
  return value
}

export function flushSync<Result>(operation?: () => Result): Result | undefined {
  return operation?.()
}

export function useActionState<State, Payload>(
  _action: (previousState: State, payload: Payload) => State | PromiseLike<State>,
  initialState: State,
  permalink?: string,
): [State, (payload: Payload) => void, boolean] {
  const dispatch = (_payload: Payload): void => serverDispatch()
  if (permalink !== undefined) Object.defineProperty(dispatch, 'permalink', { value: permalink })
  return [initialState, dispatch, false]
}

export function useOptimistic<Value, Update = Value>(
  passthrough: Value,
  _reducer?: (current: Value, update: Update) => Value,
): [Value, (update: Update) => void] {
  return [passthrough, serverDispatch]
}

export function useFormStatus(): {
  readonly pending: false
  readonly data: null
  readonly method: 'get'
  readonly action: null
} {
  return { pending: false, data: null, method: 'get', action: null }
}

export function useMemo<Value>(factory: () => Value, _dependencies: readonly unknown[]): Value {
  return factory()
}

export function useCallback<Value extends (...arguments_: never[]) => unknown>(
  callback: Value,
  _dependencies: readonly unknown[],
): Value {
  return callback
}

export function useRef<Value>(initial: Value): { current: Value } {
  return { current: initial }
}

export function useEffect(
  _create: () => void | (() => void),
  _dependencies?: readonly unknown[],
): void {}

export const useLayoutEffect = useEffect
export const useInsertionEffect = useEffect

export function useImperativeHandle(
  _ref: unknown,
  _create: () => unknown,
  _dependencies?: readonly unknown[],
): void {}

export function useEffectEvent<Arguments extends unknown[], Result>(
  callback: (...arguments_: Arguments) => Result,
): (...arguments_: Arguments) => Result {
  return callback
}

export function useSyncExternalStore<Value>(
  _subscribe: (notify: () => void) => () => void,
  getSnapshot: () => Value,
  getServerSnapshot?: () => Value,
): Value {
  return (getServerSnapshot ?? getSnapshot)()
}

export function useId(): string {
  const context = (activeRender ??= {
    hydrationMarkers: true,
    identifierPrefix: '',
    nextBoundary: 0,
    nextId: 0,
    activityHidden: false,
  })
  const id = `:${context.identifierPrefix}r${context.nextId}:`
  context.nextId += 1
  return id
}

export function createContext<Value>(defaultValue: Value): ServerContext<Value> {
  let context: ServerContext<Value>
  const Provider: ServerComponent = (props) =>
    serverNode((renderContext) => {
      context[SERVER_CONTEXT].stack.push(props.value as Value)
      try {
        return serializeChild(props.children as ServerChild, renderContext)
      } finally {
        context[SERVER_CONTEXT].stack.pop()
      }
    }, 'transparent')
  context = { [SERVER_CONTEXT]: { defaultValue, stack: [] }, Provider }
  serverBuiltins.add(Provider)
  return context
}

export function useContext<Value>(context: ServerContext<Value>): Value {
  const state = context[SERVER_CONTEXT]
  return state.stack.length === 0 ? state.defaultValue : (state.stack.at(-1) as Value)
}

export function createResource<Value>(input: PromiseLike<Value>): ServerAsyncResource<Value> {
  if (!isPromiseLike(input)) throw new TypeError('createResource requires a promise-like value')
  const existing = serverPromiseResources.get(input as object) as
    | ServerAsyncResource<Value>
    | undefined
  if (existing !== undefined) return existing
  let state: ServerAsyncState<Value> = { status: 'pending' }
  const resource = { promise: input } as ServerAsyncResource<Value>
  Object.defineProperty(resource, SERVER_ASYNC_RESOURCE, { get: () => state })
  serverPromiseResources.set(input as object, resource as ServerAsyncResource<unknown>)
  void Promise.resolve(input).then(
    (value) => {
      if (state.status === 'pending') state = { status: 'fulfilled', value }
    },
    (reason: unknown) => {
      if (state.status === 'pending') state = { status: 'rejected', reason }
    },
  )
  return resource
}

export function use<Value>(
  input: ServerContext<Value> | ServerAsyncResource<Value> | PromiseLike<Value>,
): Value {
  if (isServerContext<Value>(input)) return useContext(input)
  const resource = isServerAsyncResource<Value>(input) ? input : createResource(input)
  const state = resource[SERVER_ASYNC_RESOURCE]
  if (state.status === 'fulfilled') return state.value
  if (state.status === 'rejected') throw state.reason
  throw { [SERVER_SUSPENSION]: true, resource } satisfies ServerSuspension
}

export function lazy<Props extends Record<string, unknown>>(
  load: () => PromiseLike<ServerLazyModule<Props>>,
): ServerComponent {
  let resource: ServerAsyncResource<ServerLazyModule<Props>> | undefined
  return (props) => {
    resource ??= createResource(load())
    const module = use(resource)
    if (typeof module?.default !== 'function') {
      throw new TypeError('lazy loader must resolve to a default component export')
    }
    return module.default(props as Props)
  }
}

export function Suspense(props: Record<string, unknown>): ServerNode {
  const render = props.children
  const fallback = props.fallback
  if (typeof render !== 'function' || typeof fallback !== 'function') {
    throw new TypeError(
      'Suspense children and fallback must be compiler-generated render functions',
    )
  }
  return serverNode((context) => {
    try {
      return serializeChild((render as () => ServerChild)(), context)
    } catch (error) {
      if (!isServerSuspension(error)) throw error
      activeFrameworkRender?.pending.add(error.resource.promise)
      const pendingMarker = context.hydrationMarkers ? `<!--${HYDRATION_PREFIX}:p-->` : ''
      return pendingMarker + serializeChild((fallback as () => ServerChild)(), context)
    }
  }, 'transparent')
}

serverBuiltins.add(Suspense)

export function Activity(props: Record<string, unknown>): ServerNode {
  const render = props.children
  if (typeof render !== 'function') {
    throw new TypeError('Activity children must be a compiler-generated render function')
  }
  if (props.mode !== 'visible' && props.mode !== 'hidden') {
    throw new TypeError('Activity mode must be "visible" or "hidden"')
  }
  return serverNode((context) => {
    const previousActivityHidden = context.activityHidden
    context.activityHidden = props.mode === 'hidden' || previousActivityHidden
    try {
      return serializeChild((render as () => ServerChild)(), context)
    } finally {
      context.activityHidden = previousActivityHidden
    }
  }, 'transparent')
}

serverBuiltins.add(Activity)

export function Profiler(props: Record<string, unknown>): ServerChild {
  const render = props.children
  if (typeof render !== 'function') {
    throw new TypeError('Profiler children must be a compiler-generated render function')
  }
  if (typeof props.id !== 'string') throw new TypeError('Profiler id must be a string')
  if (typeof props.onRender !== 'function') {
    throw new TypeError('Profiler onRender must be a function')
  }
  return (render as () => ServerChild)()
}

serverBuiltins.add(Profiler)

export function useDebugValue<Value>(_value: Value, _format?: (value: Value) => unknown): void {}

export function captureOwnerStack(): null {
  return null
}

export function createPortal(_children: ServerChild, _container: unknown): never {
  throw new Error(
    'portals cannot be emitted by the server target; render portal content in the client root',
  )
}

function serverNode(
  render: (context: RenderContext) => string,
  kind: ServerNode[typeof SERVER_NODE_KIND],
): ServerNode {
  return { [SERVER_NODE]: render, [SERVER_NODE_KIND]: kind }
}

function isServerNode(value: unknown): value is ServerNode {
  return typeof value === 'object' && value !== null && SERVER_NODE in value
}

function isServerContext<Value>(value: unknown): value is ServerContext<Value> {
  return typeof value === 'object' && value !== null && SERVER_CONTEXT in value
}

function isServerAsyncResource<Value>(value: unknown): value is ServerAsyncResource<Value> {
  return typeof value === 'object' && value !== null && SERVER_ASYNC_RESOURCE in value
}

function isServerSuspension(value: unknown): value is ServerSuspension {
  return typeof value === 'object' && value !== null && SERVER_SUSPENSION in value
}

function serializeChild(value: ServerChild, context: RenderContext, markScalar = true): string {
  if (value === null || value === undefined || typeof value === 'boolean') {
    return context.hydrationMarkers && markScalar ? hydrationRange('t', '') : ''
  }
  if (isServerNode(value)) {
    const content = value[SERVER_NODE](context)
    return context.hydrationMarkers && value[SERVER_NODE_KIND] === 'intrinsic'
      ? hydrationRange('s', content)
      : content
  }
  if (isRenderable(value)) return serializeChild(cloneRenderable(value), context, markScalar)
  if (Array.isArray(value)) {
    const content = value.map((child) => serializeChild(child, context, markScalar)).join('')
    return context.hydrationMarkers ? hydrationRange('a', content) : content
  }
  if (typeof value === 'object' || typeof value === 'function' || typeof value === 'symbol') {
    throw new TypeError('unsupported server child value')
  }
  const content = escapeText(String(value))
  if (context.activityHidden && content !== '') {
    throw new TypeError('initially hidden Activity server children require a host element root')
  }
  return context.hydrationMarkers && markScalar ? hydrationRange('t', content) : content
}

function hasRenderableChild(value: ServerChild): boolean {
  if (value === null || value === undefined || typeof value === 'boolean') return false
  return !Array.isArray(value) || value.some(hasRenderableChild)
}

function serializeAttributes(props: ServerProps, hiddenByActivity = false): string {
  if (props === null) return ' style="display:none!important"'
  const attributes = Object.keys(props)
    .toSorted()
    .map((name) =>
      name === 'style'
        ? serializeStyleAttribute(props[name], hiddenByActivity)
        : serializeAttribute(name, props[name]),
    )
    .join('')
  return hiddenByActivity && !Object.hasOwn(props, 'style')
    ? `${attributes} style="display:none!important"`
    : attributes
}

function serializeAttribute(name: string, value: unknown): string {
  if (
    (name === 'action' || name === 'formAction') &&
    typeof value === 'function' &&
    typeof Reflect.get(value, 'permalink') === 'string'
  ) {
    return ` ${serverHtmlAttributeName(name)}="${escapeAttribute(Reflect.get(value, 'permalink') as string)}"`
  }
  if (
    name === 'children' ||
    name === 'dangerouslySetInnerHTML' ||
    name === 'key' ||
    name === 'precedence' ||
    name === 'ref' ||
    /^on/i.test(name) ||
    value === null ||
    value === undefined ||
    typeof value === 'function' ||
    typeof value === 'symbol'
  ) {
    return ''
  }
  if (name === 'style') return serializeStyleAttribute(value)
  const normalizedName = serverHtmlAttributeName(name)
  if (name.startsWith('data-') || name.startsWith('aria-')) {
    return ` ${normalizedName}="${escapeAttribute(String(value))}"`
  }
  if (SERVER_BOOLEAN_ATTRIBUTES.has(name)) return value ? ` ${normalizedName}=""` : ''
  if (typeof value === 'boolean') return ''
  if (!VALID_ATTRIBUTE_NAME.test(normalizedName)) return ''
  return ` ${normalizedName}="${escapeAttribute(String(value))}"`
}

function beginFrameworkRenderPass(): void {
  const framework = activeFrameworkRender
  if (framework === undefined) return
  if (framework.signal.aborted) throw frameworkAbortReason(framework.signal)
  framework.pending.clear()
  framework.head.clear()
  framework.stylePrecedence.length = 0
  framework.sawHead = false
}

function finalizeFrameworkHtml(html: string): string {
  const framework = activeFrameworkRender
  if (framework === undefined) return html
  const head = [...framework.head.entries()]
    .toSorted(([, left], [, right]) => compareHeadPrecedence(framework, left, right))
    .map(([, entry]) => entry.html)
    .join('')
  if (framework.sawHead) return html.replace(FRAMEWORK_HEAD_PLACEHOLDER, head)
  if (head === '') return html
  const htmlStart = html.indexOf('<html')
  if (htmlStart !== -1) {
    const htmlOpenEnd = html.indexOf('>', htmlStart)
    if (htmlOpenEnd !== -1) {
      return `${html.slice(0, htmlOpenEnd + 1)}<head>${head}</head>${html.slice(htmlOpenEnd + 1)}`
    }
  }
  return `<head>${head}</head>${html}`
}

function isHoistableHeadElement(type: string, props: ServerProps): boolean {
  if (type === 'title' || type === 'meta') return !hasOwnProp(props, 'itemProp')
  if (type === 'link') {
    if (['itemProp', 'onLoad', 'onError', 'disabled'].some((name) => hasOwnProp(props, name))) {
      return false
    }
    return props?.rel !== 'stylesheet' || typeof props.precedence === 'string'
  }
  if (type === 'style') {
    return typeof props?.href === 'string' && typeof props.precedence === 'string'
  }
  return type === 'script' && props?.async === true && typeof props.src === 'string'
}

function hasOwnProp(props: ServerProps, name: string): boolean {
  return props !== null && Object.hasOwn(props, name)
}

function metadataKey(type: string, props: ServerProps): string {
  if (type === 'title') return 'title'
  if (type === 'meta') {
    for (const name of META_IDENTITY_PROPS) {
      const value = props?.[name]
      if (value !== undefined) return `meta:${name}:${String(value)}`
    }
  }
  if (type === 'link')
    return `link:${LINK_IDENTITY_PROPS.map((name) => String(props?.[name] ?? '')).join(':')}`
  if (type === 'style') return `style:${String(props?.href ?? '')}`
  if (type === 'script') return `script:${String(props?.src ?? '')}`
  return `${type}:${JSON.stringify(props)}`
}

function metadataPrecedence(type: string, props: ServerProps): string {
  if (type === 'style' || (type === 'link' && props?.rel === 'stylesheet')) {
    return `2:${String(props?.precedence ?? 'default')}`
  }
  if (type === 'script') return '3:script'
  return '1:metadata'
}

function registerResourceHint(
  relation: string,
  href: string,
  options: ResourceHintOptions | PreloadOptions,
): void {
  if (typeof href !== 'string' || href.length === 0)
    throw new TypeError('resource href must be non-empty')
  const as =
    'as' in options && typeof options.as === 'string' ? ` as="${escapeAttribute(options.as)}"` : ''
  registerHeadEntry(
    `hint:${relation}:${href}:${as}`,
    `<link rel="${relation}" href="${escapeAttribute(href)}"${as}${serializeHintOptions(options)}>`,
    '0:hint',
  )
}

function registerHeadEntry(key: string, html: string, precedence: string): void {
  const framework = activeFrameworkRender
  if (framework === undefined) return
  if (precedence.startsWith('2:')) {
    const stylePrecedence = precedence.slice(2)
    if (!framework.stylePrecedence.includes(stylePrecedence)) {
      framework.stylePrecedence.push(stylePrecedence)
    }
  }
  framework.head.set(key, { html, precedence })
}

function compareHeadPrecedence(
  framework: ServerFrameworkRenderContext,
  left: { readonly precedence: string },
  right: { readonly precedence: string },
): number {
  const leftRank = Number(left.precedence[0])
  const rightRank = Number(right.precedence[0])
  if (leftRank !== rightRank) return leftRank - rightRank
  if (leftRank !== 2) return 0
  return (
    framework.stylePrecedence.indexOf(left.precedence.slice(2)) -
    framework.stylePrecedence.indexOf(right.precedence.slice(2))
  )
}

function serializeHintOptions(
  options: ResourceHintOptions | PreloadOptions | PreinitOptions,
): string {
  const attributes: string[] = []
  if (options.crossOrigin !== undefined) {
    attributes.push(` crossorigin="${escapeAttribute(options.crossOrigin)}"`)
  }
  if ('fetchPriority' in options && options.fetchPriority !== undefined) {
    attributes.push(` fetchpriority="${options.fetchPriority}"`)
  }
  if ('imageSizes' in options && options.imageSizes !== undefined) {
    attributes.push(` imagesizes="${escapeAttribute(options.imageSizes)}"`)
  }
  if ('imageSrcSet' in options && options.imageSrcSet !== undefined) {
    attributes.push(` imagesrcset="${escapeAttribute(options.imageSrcSet)}"`)
  }
  if ('integrity' in options && options.integrity !== undefined) {
    attributes.push(` integrity="${escapeAttribute(options.integrity)}"`)
  }
  if ('nonce' in options && options.nonce !== undefined) {
    attributes.push(` nonce="${escapeAttribute(options.nonce)}"`)
  }
  if ('referrerPolicy' in options && options.referrerPolicy !== undefined) {
    attributes.push(` referrerpolicy="${escapeAttribute(options.referrerPolicy)}"`)
  }
  if ('type' in options && options.type !== undefined) {
    attributes.push(` type="${escapeAttribute(options.type)}"`)
  }
  return attributes.join('')
}

function frameworkAbortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
}

function serializeStyleAttribute(value: unknown, hiddenByActivity = false): string {
  if (typeof value === 'string') {
    const separator = value === '' || value.endsWith(';') ? '' : ';'
    const style = hiddenByActivity ? `${value}${separator}display:none!important` : value
    return style === '' ? '' : ` style="${escapeAttribute(style)}"`
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return hiddenByActivity ? ' style="display:none!important"' : ''
  }

  const declarations = Object.entries(value)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .flatMap(([name, item]) => {
      if (item === null || item === undefined || typeof item === 'boolean' || item === '') return []
      const cssName = name.startsWith('--') ? name : camelToKebab(name)
      const cssValue =
        typeof item === 'number' && item !== 0 && !UNITLESS_STYLE_PROPERTIES.has(name)
          ? `${item}px`
          : item
      return `${cssName}:${String(cssValue)}`
    })
  if (hiddenByActivity) declarations.push('display:none!important')
  return declarations.length === 0 ? '' : ` style="${escapeAttribute(declarations.join(';'))}"`
}

function camelToKebab(name: string): string {
  return name
    .replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`)
    .replace(/^ms-/, '-ms-')
}

function readRawHtml(props: ServerProps): string | undefined {
  const value = props?.dangerouslySetInnerHTML
  if (value === null || value === undefined) return undefined
  if (!UNSAFE_HTML) {
    throw new Error('dangerouslySetInnerHTML requires the unsafe-html compiler feature')
  }
  if (typeof value !== 'object' || !('__html' in value)) {
    throw new TypeError('dangerouslySetInnerHTML must be an object with an __html property')
  }
  const html = Reflect.get(value, '__html') as unknown
  return html === null || html === undefined ? '' : String(html)
}

function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function escapeAttribute(value: string): string {
  return escapeText(value).replaceAll('"', '&quot;').replaceAll("'", '&#x27;')
}

function serializeChildren(
  value: ServerChild,
  context: RenderContext,
  markScalar: boolean,
): string {
  return Array.isArray(value)
    ? value.map((child) => serializeSlot(child, context, markScalar)).join('')
    : serializeSlot(value, context, markScalar)
}

function serializeSlot(value: ServerChild, context: RenderContext, markScalar = true): string {
  const content = serializeChild(value, context, markScalar)
  return context.hydrationMarkers ? hydrationRange('b', content) : content
}

function hydrationRange(kind: 'a' | 'b' | 'c' | 'h' | 'r' | 's' | 't', content: string): string {
  return `<!--${HYDRATION_PREFIX}:${kind}-->${content}<!--/${HYDRATION_PREFIX}:${kind}-->`
}

function assertSafeHydrationRawHtml(value: string): string {
  if (/<!--\/?vidact:v\d+:/i.test(value)) {
    throw new Error('raw HTML cannot contain Vidact hydration marker syntax')
  }
  return value
}

function isRawTextElement(type: string): boolean {
  return type === 'script' || type === 'style' || type === 'textarea' || type === 'title'
}

function serverDispatch(): never {
  throw new Error('state dispatch is unavailable during server rendering')
}
