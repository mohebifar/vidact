// oxlint-disable-next-line typescript/triple-slash-reference -- Include compiler feature defines.
/// <reference path="./env.d.ts" />

const SERVER_NODE = Symbol('Vidact.ServerNode')
const SERVER_NODE_KIND = Symbol('Vidact.ServerNodeKind')
const SERVER_CONTEXT = Symbol('Vidact.ServerContext')
const SERVER_ASYNC_RESOURCE = Symbol('Vidact.ServerAsyncResource')
const SERVER_SUSPENSION = Symbol('Vidact.ServerSuspension')

export interface ServerNode {
  readonly [SERVER_NODE]: (context: RenderContext) => string
  readonly [SERVER_NODE_KIND]: 'component' | 'intrinsic' | 'transparent'
}

export type ServerChild =
  | ServerNode
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined
  | readonly ServerChild[]

export type ServerComponent = (props: Record<string, unknown>) => ServerChild
export type ServerElementType = string | typeof Fragment | ServerComponent
export type ServerProps = Record<string, unknown> | null

export interface ServerRenderOptions {
  readonly identifierPrefix?: string
}

interface RenderContext {
  hydrationMarkers: boolean
  identifierPrefix: string
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

const BOOLEAN_ATTRIBUTES = new Set([
  'allowFullScreen',
  'async',
  'autoFocus',
  'autoPlay',
  'checked',
  'controls',
  'default',
  'defer',
  'disabled',
  'formNoValidate',
  'hidden',
  'inert',
  'loop',
  'multiple',
  'muted',
  'noModule',
  'noValidate',
  'open',
  'playsInline',
  'readOnly',
  'required',
  'reversed',
  'selected',
])

const UNITLESS_STYLES = new Set([
  'animationIterationCount',
  'aspectRatio',
  'columnCount',
  'fillOpacity',
  'flex',
  'flexGrow',
  'flexShrink',
  'fontWeight',
  'gridArea',
  'gridColumn',
  'gridColumnEnd',
  'gridColumnStart',
  'gridRow',
  'gridRowEnd',
  'gridRowStart',
  'lineHeight',
  'opacity',
  'order',
  'orphans',
  'scale',
  'strokeOpacity',
  'strokeWidth',
  'tabSize',
  'widows',
  'zIndex',
  'zoom',
])

const ATTRIBUTE_ALIASES: Readonly<Record<string, string>> = {
  acceptCharset: 'accept-charset',
  className: 'class',
  crossOrigin: 'crossorigin',
  defaultChecked: 'checked',
  defaultValue: 'value',
  formAction: 'formaction',
  htmlFor: 'for',
  httpEquiv: 'http-equiv',
}

const VALID_ATTRIBUTE_NAME = /^[A-Za-z_:][A-Za-z0-9:._-]*$/
const HYDRATION_PREFIX = 'vidact:v1'
const UNSAFE_HTML = typeof __VIDACT_UNSAFE_HTML__ !== 'undefined' && __VIDACT_UNSAFE_HTML__

let activeRender: RenderContext | undefined
const serverBuiltins = new WeakSet<ServerComponent>()
const serverPromiseResources = new WeakMap<object, ServerAsyncResource<unknown>>()

export const Fragment = Symbol('Vidact.ServerFragment')

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
  return serverNode((context) => {
    const hiddenByActivity = context.activityHidden
    const previousActivityHidden = context.activityHidden
    context.activityHidden = false
    try {
      const attributes = serializeAttributes(props, hiddenByActivity)
      if (VOID_ELEMENTS.has(type)) {
        if (
          hasRenderableChild(props?.children as ServerChild) ||
          readRawHtml(props) !== undefined
        ) {
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
      return `<${type}${attributes}>${children}</${type}>`
    } finally {
      context.activityHidden = previousActivityHidden
    }
  }, 'intrinsic')
}

export function renderToString(
  value: ServerChild | (() => ServerChild),
  options: ServerRenderOptions = {},
): string {
  const previous = activeRender
  const context = {
    hydrationMarkers: true,
    identifierPrefix: options.identifierPrefix ?? '',
    nextId: 0,
    activityHidden: false,
  }
  activeRender = context
  try {
    return hydrationRange(
      'r',
      serializeSlot(typeof value === 'function' ? value() : value, context),
    )
  } finally {
    activeRender = previous
  }
}

export function renderToStaticMarkup(
  value: ServerChild | (() => ServerChild),
  options: ServerRenderOptions = {},
): string {
  const previous = activeRender
  const context = {
    hydrationMarkers: false,
    identifierPrefix: options.identifierPrefix ?? '',
    nextId: 0,
    activityHidden: false,
  }
  activeRender = context
  try {
    return serializeChild(typeof value === 'function' ? value() : value, context)
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
  const resource = {} as ServerAsyncResource<Value>
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

function isPromiseLike<Value>(value: unknown): value is PromiseLike<Value> {
  return (
    ((typeof value === 'object' && value !== null) || typeof value === 'function') &&
    typeof (value as PromiseLike<Value>).then === 'function'
  )
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
    return ` ${attributeName(name)}="${escapeAttribute(Reflect.get(value, 'permalink') as string)}"`
  }
  if (
    name === 'children' ||
    name === 'dangerouslySetInnerHTML' ||
    name === 'key' ||
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
  const normalizedName = attributeName(name)
  if (name.startsWith('data-') || name.startsWith('aria-')) {
    return ` ${normalizedName}="${escapeAttribute(String(value))}"`
  }
  if (BOOLEAN_ATTRIBUTES.has(normalizedName)) return value ? ` ${normalizedName}=""` : ''
  if (typeof value === 'boolean') return ''
  if (!VALID_ATTRIBUTE_NAME.test(normalizedName)) return ''
  return ` ${normalizedName}="${escapeAttribute(String(value))}"`
}

function attributeName(name: string): string {
  return ATTRIBUTE_ALIASES[name] ?? name
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
        typeof item === 'number' && item !== 0 && !UNITLESS_STYLES.has(name) ? `${item}px` : item
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
