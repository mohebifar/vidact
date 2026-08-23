// oxlint-disable-next-line typescript/triple-slash-reference -- Include compiler feature defines.
/// <reference path="./env.d.ts" />

const SERVER_NODE = Symbol('Vidact.ServerNode')
const SERVER_CONTEXT = Symbol('Vidact.ServerContext')

export interface ServerNode {
  readonly [SERVER_NODE]: (context: RenderContext) => string
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
  identifierPrefix: string
  nextId: number
}

interface ContextState<Value> {
  readonly defaultValue: Value
  readonly stack: Value[]
}

export interface ServerContext<Value> {
  readonly Provider: ServerComponent
  readonly [SERVER_CONTEXT]: ContextState<Value>
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
  htmlFor: 'for',
  httpEquiv: 'http-equiv',
}

const VALID_ATTRIBUTE_NAME = /^[A-Za-z_:][A-Za-z0-9:._-]*$/
const UNSAFE_HTML = typeof __VIDACT_UNSAFE_HTML__ !== 'undefined' && __VIDACT_UNSAFE_HTML__

let activeRender: RenderContext | undefined

export const Fragment = Symbol('Vidact.ServerFragment')

export function jsx(type: ServerElementType, props: ServerProps, _key?: unknown): ServerNode {
  if (type === Fragment) {
    return serverNode((context) => serializeChild(props?.children as ServerChild, context))
  }
  if (typeof type === 'function') {
    return serverNode((context) => serializeChild(type(props ?? {}), context))
  }

  if (!VALID_ATTRIBUTE_NAME.test(type)) throw new TypeError(`invalid server element name ${type}`)
  return serverNode((context) => {
    const attributes = serializeAttributes(props)
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
    const children = rawHtml ?? serializeChild(props?.children as ServerChild, context)
    return `<${type}${attributes}>${children}</${type}>`
  })
}

export const jsxs = jsx

export function renderToString(
  value: ServerChild | (() => ServerChild),
  options: ServerRenderOptions = {},
): string {
  const previous = activeRender
  const context = {
    identifierPrefix: options.identifierPrefix ?? '',
    nextId: 0,
  }
  activeRender = context
  try {
    return serializeChild(typeof value === 'function' ? value() : value, context)
  } finally {
    activeRender = previous
  }
}

export const renderToStaticMarkup = renderToString

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
  const context = (activeRender ??= { identifierPrefix: '', nextId: 0 })
  const id = `:${context.identifierPrefix}v${context.nextId.toString(32)}:`
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
    })
  context = { [SERVER_CONTEXT]: { defaultValue, stack: [] }, Provider }
  return context
}

export function useContext<Value>(context: ServerContext<Value>): Value {
  const state = context[SERVER_CONTEXT]
  return state.stack.at(-1) ?? state.defaultValue
}

export function use<Value>(context: ServerContext<Value>): Value {
  return useContext(context)
}

export function createPortal(_children: ServerChild, _container: unknown): never {
  throw new Error(
    'portals cannot be emitted by the server target; render portal content in the client root',
  )
}

function serverNode(render: (context: RenderContext) => string): ServerNode {
  return { [SERVER_NODE]: render }
}

function isServerNode(value: unknown): value is ServerNode {
  return typeof value === 'object' && value !== null && SERVER_NODE in value
}

function serializeChild(value: ServerChild, context: RenderContext): string {
  if (value === null || value === undefined || typeof value === 'boolean') return ''
  if (isServerNode(value)) return value[SERVER_NODE](context)
  if (Array.isArray(value)) return value.map((child) => serializeChild(child, context)).join('')
  if (typeof value === 'object' || typeof value === 'function' || typeof value === 'symbol') {
    throw new TypeError('unsupported server child value')
  }
  return escapeText(String(value))
}

function hasRenderableChild(value: ServerChild): boolean {
  if (value === null || value === undefined || typeof value === 'boolean') return false
  return !Array.isArray(value) || value.some(hasRenderableChild)
}

function serializeAttributes(props: ServerProps): string {
  if (props === null) return ''
  return Object.keys(props)
    .toSorted()
    .map((name) => serializeAttribute(name, props[name]))
    .join('')
}

function serializeAttribute(name: string, value: unknown): string {
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
  if (BOOLEAN_ATTRIBUTES.has(name)) return value ? ` ${attributeName(name)}=""` : ''
  if (typeof value === 'boolean') return ''

  const normalizedName = attributeName(name)
  if (!VALID_ATTRIBUTE_NAME.test(normalizedName)) return ''
  return ` ${normalizedName}="${escapeAttribute(String(value))}"`
}

function attributeName(name: string): string {
  return ATTRIBUTE_ALIASES[name] ?? name
}

function serializeStyleAttribute(value: unknown): string {
  if (typeof value === 'string') return ` style="${escapeAttribute(value)}"`
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return ''

  const declarations = Object.entries(value)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .flatMap(([name, item]) => {
      if (item === null || item === undefined || typeof item === 'boolean' || item === '') return []
      const cssName = name.startsWith('--') ? name : camelToKebab(name)
      const cssValue =
        typeof item === 'number' && item !== 0 && !UNITLESS_STYLES.has(name) ? `${item}px` : item
      return `${cssName}:${String(cssValue)}`
    })
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

function serverDispatch(): never {
  throw new Error('state dispatch is unavailable during server rendering')
}
